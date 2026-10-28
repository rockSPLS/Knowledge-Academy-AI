import "server-only";
import { z } from "zod";
import { generateStructured, type ModelResult } from "@/lib/llm/client";
import { describeEmbeddingError, embedQuery, readEmbeddingConfig } from "./embeddings";
import { ANSWER_SYSTEM, answerPrompt, type PromptFragment } from "./prompts";
import { combine, rankSemantic, rankWords, RESULT_COUNT } from "./rank";
import indexFile from "./search-index.json";
import type { IndexedChunk, SearchAnswer, SearchIndexFile, SearchMode, SearchResponse, SearchSource } from "./types";
import { buildWordIndex } from "./words";

// Поиск по материалам портала и ответ модели по найденным фрагментам.
// Индекс (search-index.json) читается только здесь, на сервере: в нём объяснения
// упражнений, а в браузер уходят только SearchSource — путь, ссылка и начало текста,
// у упражнения — только вопрос.
//
// 1. Вопрос → эмбеддинг вопроса → близость со всеми фрагментами, плюс поиск по словам;
//    два списка сочетаются по рангам (rank.ts). Без настроек эмбеддингов или при ошибке
//    сервиса — только по словам.
// 2. Модель отвечает только по найденным фрагментам, со ссылками [N]. Модель недоступна
//    или ответила не по схеме — фрагменты всё равно показываются, ответа нет.

const index = indexFile as SearchIndexFile;
const vectors = index.chunks.map((chunk) => chunk.embedding);
const wordIndex = buildWordIndex(index.chunks.map((chunk) => chunk.text));

// Тайм-аут и потолок длины ответа модели: ответ короткий (2–5 предложений)
const ANSWER_TIMEOUT_MS = 25_000;
const ANSWER_MAX_OUTPUT_TOKENS = 1500;
// Сколько символов текста раздела показывать в источнике
const SNIPPET_LENGTH = 180;

export type Found = { mode: SearchMode; chunks: IndexedChunk[] };

export async function findChunks(question: string, abortSignal?: AbortSignal): Promise<Found> {
  const byWords = rankWords(wordIndex, question);
  const config = readEmbeddingConfig();
  let mode: SearchMode = "words";
  let ranked = byWords;
  if (config && index.model === config.model) {
    try {
      const query = await embedQuery(config, question, abortSignal);
      ranked = combine(rankSemantic(vectors, query), byWords);
      mode = "semantic-and-words";
    } catch (error) {
      if (!abortSignal?.aborted) {
        console.error(`[search] эмбеддинг вопроса не получен, ищем по словам: ${describeEmbeddingError(error)}`);
      }
    }
  } else if (config) {
    // Векторы разных моделей несравнимы: индекс нужно пересчитать (npm run search:index)
    console.error(`[search] индекс посчитан моделью ${index.model ?? "—"}, а в настройках ${config.model} — ищем по словам`);
  }
  return { mode, chunks: ranked.slice(0, RESULT_COUNT).map((item) => index.chunks[item.index]) };
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
}) => Promise<ModelResult<AnswerOutput>>;

export const askAnswer: AskAnswer = ({ system, prompt, abortSignal }) =>
  generateStructured({
    schema: answerSchema,
    system,
    prompt,
    timeoutMs: ANSWER_TIMEOUT_MS,
    maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
    abortSignal,
  });

// Полный ответ маршрута: найденные фрагменты как источники и ответ модели (или null)
export async function searchAndAnswer(
  question: string,
  ask: AskAnswer = askAnswer,
  abortSignal?: AbortSignal,
  found?: Found,
): Promise<SearchResponse> {
  const { mode, chunks } = found ?? (await findChunks(question, abortSignal));
  const sources = chunks.map(toSource);
  if (chunks.length === 0) return { question, mode, sources, answer: null, notInMaterials: false };

  const result = await ask({
    question,
    chunkIds: chunks.map((chunk) => chunk.id),
    system: ANSWER_SYSTEM,
    prompt: answerPrompt(question, chunks.map(toPromptFragment)),
    abortSignal,
  });
  if (!result.ok) return { question, mode, sources, answer: null, notInMaterials: false };
  const answer = checkAnswer(result.data, chunks.length);
  return { question, mode, sources, answer, notInMaterials: answer !== null && !result.data.inMaterials };
}

// Проверка ответа модели: номера источников в тексте — только из переданных фрагментов,
// чужие убираются. «[1, 3]» записывается как «[1][3]» — так интерфейс превращает каждый
// номер в ссылку. Пустой ответ — как будто ответа нет
export function checkAnswer(output: AnswerOutput, count: number): SearchAnswer | null {
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= count;
  const text = output.answer
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
  return { text };
}

function toSource(chunk: IndexedChunk, i: number): SearchSource {
  return {
    number: i + 1,
    kind: chunk.kind,
    path: chunk.path,
    href: `/articles/${chunk.articleSlug}${chunk.sectionId ? `#${chunk.sectionId}` : ""}`,
    snippet: chunk.kind === "exercise" ? (chunk.question ?? "") : snippet(sectionBody(chunk)),
  };
}

function toPromptFragment(chunk: IndexedChunk): PromptFragment {
  return chunk.kind === "exercise"
    ? { kind: "exercise", path: chunk.path, question: chunk.question ?? "" }
    : { kind: "section", path: chunk.path, text: sectionBody(chunk) };
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
