import "server-only";
import { z } from "zod";
import type { LanguageModelUsage } from "ai";
import { generateStructured, type ModelResult } from "@/lib/llm/client";
import { getExercise } from "@/lib/exercises/bank";
import type { Verdict } from "@/lib/exercises/types";
import { describeEmbeddingError, embedQuery, readEmbeddingConfig } from "./embeddings";
import { decodeVector, encodeVector, journeyChunks, shortQuery, type JourneyChunk } from "./journeys";
import { hasProgress, latestResults, progressBlock, resultLabel } from "./progress";
import type { ProgressInput } from "./request";
import { ANSWER_SYSTEM, answerPrompt, type PromptFragment } from "./prompts";
import { combine, rankSemanticParts, rankWords, RESULT_COUNT } from "./rank";
import { fitsScripts, foreignScripts } from "./scripts";
import indexFile from "./search-index.json";
import type {
  IndexedChunk,
  JourneySearchInput,
  SearchAnswer,
  SearchIndexFile,
  SearchMode,
  SearchResponse,
  SearchSource,
} from "./types";
import { buildWordIndex, extendWordIndex } from "./words";

// Поиск по материалам портала и ответ модели по найденным фрагментам.
// Индекс (search-index.json) читается только здесь, на сервере: в нём объяснения
// упражнений. В браузер уходят только SearchSource — путь, ссылка и начало текста,
// у упражнения — вопрос, а объяснение — только если человек на него уже отвечал.
// Кроме статей и упражнений поиск идёт по сохранённым путешествиям, которые браузер
// присылает вместе с вопросом (journeys.ts), и учитывает сводку прогресса (progress.ts).
//
// 1. Вопрос → эмбеддинг вопроса → близость со всеми фрагментами, плюс поиск по словам;
//    два списка сочетаются по рангам (rank.ts). Без настроек эмбеддингов или при ошибке
//    сервиса — только по словам.
// 2. Модель отвечает только по найденным фрагментам и прогрессу, со ссылками [N].
//    Модель недоступна, ответила не по схеме или письмом, которого нет в данных, — фрагменты
//    всё равно показываются, ответа нет.

const index = indexFile as SearchIndexFile;
const vectors = index.chunks.map((chunk) => chunk.embedding);
const headings = index.chunks.map((chunk) => chunk.headingEmbedding);
const wordIndex = buildWordIndex(index.chunks.map((chunk) => chunk.text));

// Тайм-аут и потолок длины ответа модели: ответ о материалах — 2–5 предложений, о самом
// человеке — до 8; в потолок входит и рассуждение модели (около 1000 токенов на замерах)
const ANSWER_TIMEOUT_MS = 25_000;
const ANSWER_MAX_OUTPUT_TOKENS = 2500;
// Сколько символов текста раздела показывать в источнике
const SNIPPET_LENGTH = 180;

// Сколько путешествий без векторов посчитать за один поиск. Обычно такое одно —
// только что созданное; после смены модели эмбеддингов — все, и тогда они досчитываются
// за несколько поисков, а запрос к сервису остаётся небольшим
const MAX_JOURNEYS_EMBEDDED_PER_SEARCH = 5;

// Фрагмент поиска: раздел или упражнение из индекса либо чекпоинт путешествия из запроса
export type Fragment = IndexedChunk | JourneyChunk;

export type Found = {
  mode: SearchMode;
  chunks: Fragment[];
  journeyVectors?: SearchResponse["journeyVectors"];
};

export async function findChunks(
  question: string,
  abortSignal?: AbortSignal,
  journeys: JourneySearchInput[] = [],
): Promise<Found> {
  const config = readEmbeddingConfig();
  const model = config && index.model === config.model ? config.model : null;
  if (config && !model) {
    // Векторы разных моделей несравнимы: индекс нужно пересчитать (npm run search:index)
    console.error(`[search] индекс посчитан моделью ${index.model ?? "—"}, а в настройках ${config.model} — ищем по словам`);
  }

  const perJourney = journeys.map((journey) => ({ journey, chunks: journeyChunks(journey, model) }));
  const journeyList = perJourney.flatMap((item) => item.chunks);
  const all: Fragment[] = [...index.chunks, ...journeyList];
  const words = journeyList.length > 0 ? extendWordIndex(wordIndex, journeyList.map((chunk) => chunk.text)) : wordIndex;
  const byWords = rankWords(words, question);

  let mode: SearchMode = "words";
  let ranked = byWords;
  let journeyVectors: Found["journeyVectors"];
  if (config && model) {
    // Путешествия без векторов (или с испорченными) — в том же запросе к сервису, что и вопрос
    const missing = perJourney
      .filter((item) => item.chunks.some((chunk) => chunk.embedding === null))
      .slice(0, MAX_JOURNEYS_EMBEDDED_PER_SEARCH);
    try {
      const { query, documents } = await embedQuery(
        config,
        question,
        abortSignal,
        missing.flatMap((item) => item.chunks.map((chunk) => chunk.text)),
      );
      let next = 0;
      journeyVectors = missing.map(({ journey, chunks }) => {
        const data = chunks.map(() => encodeVector(documents[next++]));
        // Тот же вектор, что сохранит браузер: и этот поиск, и следующие считают одинаково
        chunks.forEach((chunk, i) => (chunk.embedding = decodeVector(data[i])));
        return { journeyId: journey.id, model, data };
      });
      ranked = combine(
        rankSemanticParts([
          { vectors, query, headings },
          { vectors: journeyList.map((chunk) => chunk.embedding), query: shortQuery(query) },
        ]),
        byWords,
      );
      mode = "semantic-and-words";
    } catch (error) {
      if (!abortSignal?.aborted) {
        console.error(`[search] эмбеддинг вопроса не получен, ищем по словам: ${describeEmbeddingError(error)}`);
      }
    }
  }
  return {
    mode,
    chunks: ranked.slice(0, RESULT_COUNT).map((item) => all[item.index]),
    ...(journeyVectors && journeyVectors.length > 0 && { journeyVectors }),
  };
}

// Схема ответа модели
export const answerSchema = z.object({
  // Есть ли во фрагментах ответ на вопрос
  inMaterials: z.boolean(),
  // Ответ с номерами фрагментов [N]
  answer: z.string(),
  // Номера фрагментов, на которые ссылается ответ. В ответ маршрута не идут:
  // ссылки строятся по номерам в тексте, проверенным checkAnswer
  sources: z.array(z.number()),
});

export type AnswerOutput = z.infer<typeof answerSchema>;

// Запрос к модели за ответом. question и chunkIds — для сохранённых ответов (fixtures.ts)
export type AskAnswer = (request: {
  question: string;
  chunkIds: string[];
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
  // Расход токенов — для замеров (app/api/search/dev)
  onUsage?: (usage: LanguageModelUsage) => void;
}) => Promise<ModelResult<AnswerOutput>>;

export const askAnswer: AskAnswer = ({ system, prompt, abortSignal, onUsage }) =>
  generateStructured({
    schema: answerSchema,
    system,
    prompt,
    timeoutMs: ANSWER_TIMEOUT_MS,
    maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
    abortSignal,
    onUsage,
  });

export type SearchRequest = {
  question: string;
  journeys?: JourneySearchInput[];
  progress?: ProgressInput;
  ask?: AskAnswer;
  abortSignal?: AbortSignal;
  // Уже найденные фрагменты (сохранённые ответы и их запись — lib/search/fixtures.ts)
  found?: Found;
};

// Полный ответ маршрута: найденные фрагменты как источники и ответ модели (или null).
// Если ничего не нашлось, но прогресс есть, модель всё равно отвечает — по прогрессу:
// вопрос может быть о самом человеке («где я ошибался?»)
export async function searchAndAnswer({
  question,
  journeys,
  progress,
  ask = askAnswer,
  abortSignal,
  found,
}: SearchRequest): Promise<SearchResponse> {
  const { mode, chunks, journeyVectors } = found ?? (await findChunks(question, abortSignal, journeys));
  const results = latestResults(progress);
  const sources = chunks.map((chunk, i) => toSource(chunk, i, results));
  const base = { question, mode, sources, ...(journeyVectors && { journeyVectors }) };
  if (chunks.length === 0 && !hasProgress(progress)) return { ...base, answer: null, notInMaterials: false };

  // Тема статьи каждого фрагмента по порядку номеров — для блока «Прогресс» (progress.ts)
  const fragmentTopics = chunks.map((chunk) => (chunk.kind === "journey" ? null : `${chunk.articleSlug}#${chunk.sectionId}`));
  const prompt = answerPrompt(
    question,
    chunks.map((chunk) => toPromptFragment(chunk, results)),
    progressBlock(progress, fragmentTopics),
  );
  const result = await ask({ question, chunkIds: chunks.map((chunk) => chunk.id), system: ANSWER_SYSTEM, prompt, abortSignal });
  if (!result.ok) return { ...base, answer: null, notInMaterials: false };
  // Письмо, которого нет ни в вопросе, ни во фрагментах, ни в блоке «Прогресс», — сбой ответа
  const answer = checkAnswer(result.data, chunks.length, foreignScripts(prompt));
  return { ...base, answer, notInMaterials: answer !== null && !result.data.inMaterials };
}

// Проверка ответа модели: номера источников в тексте — только из переданных фрагментов,
// чужие убираются. «[1, 3]» записывается как «[1][3]» — так интерфейс превращает каждый
// номер в ссылку. Пустой ответ — как будто ответа нет; ответ с чужим письмом, которого нет
// среди allowedScripts (письма данных, которые получила модель, — scripts.ts), — тоже:
// человек видит найденные фрагменты без ответа
export function checkAnswer(output: AnswerOutput, count: number, allowedScripts: Set<string>): SearchAnswer | null {
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= count;
  const text = output.answer
    // Пометка «из прогресса», которую модель иногда ставит вместо номера, — не источник
    .replace(/\[(?:progress|прогресс)\]/gi, "")
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, list: string) =>
      list
        .split(",")
        .map(Number)
        .filter(valid)
        .map((n) => `[${n}]`)
        .join(""),
    )
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!text) return null;
  if (!fitsScripts(text, allowedScripts)) {
    console.warn("[search] в ответе модели письмо, которого нет в данных, — ответ не показан");
    return null;
  }
  return { text };
}

function toSource(chunk: Fragment, i: number, results: Map<string, Verdict>): SearchSource {
  const number = i + 1;
  if (chunk.kind === "journey") {
    return {
      number,
      kind: "journey",
      // Рядом с путём — ярлык «Путешествие», поэтому в пути только название; модели и поиску
      // путь остаётся прежним (lib/search/journeys.ts)
      path: [`«${chunk.journeyTitle}»`, ...chunk.path.slice(1)],
      href: `/journey?id=${encodeURIComponent(chunk.journeyId)}`,
      snippet: snippet(chunk.summary),
      journeyId: chunk.journeyId,
    };
  }
  const href = `/articles/${chunk.articleSlug}${chunk.sectionId ? `#${chunk.sectionId}` : ""}`;
  if (chunk.kind === "section") {
    return { number, kind: "section", path: chunk.path, href, snippet: snippet(sectionBody(chunk)) };
  }
  // Упражнение: ярлык и объяснение — только если человек на него уже отвечал
  const answered = answeredExercise(chunk, results);
  return {
    number,
    kind: "exercise",
    path: chunk.path,
    href,
    snippet: chunk.question ?? "",
    ...(answered && { result: resultLabel(answered.verdict), explanation: answered.explanation }),
  };
}

function toPromptFragment(chunk: Fragment, results: Map<string, Verdict>): PromptFragment {
  if (chunk.kind === "journey") {
    return {
      kind: "journey",
      journeyTitle: chunk.journeyTitle,
      checkpoint: chunk.path[1],
      concept: chunk.concept,
      text: chunk.summary,
    };
  }
  if (chunk.kind === "section") return { kind: "section", path: chunk.path, text: sectionBody(chunk) };
  const answered = answeredExercise(chunk, results);
  return { kind: "exercise", path: chunk.path, question: chunk.question ?? "", ...(answered && { answered }) };
}

// Упражнение, на которое человек уже отвечал: его последний итог и объяснение верного ответа
function answeredExercise(
  chunk: IndexedChunk,
  results: Map<string, Verdict>,
): { verdict: Verdict; explanation: string } | null {
  const verdict = chunk.exerciseId ? results.get(chunk.exerciseId) : undefined;
  const explanation = verdict && chunk.exerciseId ? getExercise(chunk.exerciseId)?.explanation : undefined;
  return verdict && explanation ? { verdict, explanation } : null;
}

// Текст раздела без пути «Статья › Раздел» в начале
function sectionBody(chunk: IndexedChunk): string {
  const prefix = `${chunk.path.join(" › ")}\n\n`;
  return chunk.text.startsWith(prefix) ? chunk.text.slice(prefix.length) : chunk.text;
}

// Начало текста: по границе слова, с многоточием, если текст обрезан
function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= SNIPPET_LENGTH) return flat;
  const cut = flat.slice(0, SNIPPET_LENGTH);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:.—–-]+$/, "")}…`;
}
