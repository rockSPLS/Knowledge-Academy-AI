import "server-only";
import { getExercise } from "@/lib/exercises/bank";
import { normalizeText } from "@/lib/exercises/text";
import type { Exercise } from "@/lib/exercises/types";
import { getAllTopics } from "@/lib/progress/topics";
import { reviewArticleTopics } from "@/lib/review/material";
import { answerErrors } from "@/lib/search/answers";
import { describeEmbeddingError, embedTexts, QUERY_INSTRUCTION, readEmbeddingConfig } from "@/lib/search/embeddings";
import { describeAnswer, latestResults } from "@/lib/search/progress";
import { MIN_SIMILARITY, rankSemantic } from "@/lib/search/rank";
import type { ProgressInput } from "@/lib/search/request";
import indexFile from "@/lib/search/search-index.json";
import type { IndexedChunk, SearchIndexFile } from "@/lib/search/types";
import type { PortalPromptFragment } from "./prompts";
import { CHECKPOINTS_MAX } from "./build";
import type { Plan, PortalPlan } from "./schemas";
import type { CheckpointSource } from "./types";

// Материал путешествия по материалам портала: разделы статей, которые поиск по смыслу
// находит по теме (порог и близость по заголовку — как в поиске, lib/search/rank.ts), —
// до MAX_FRAGMENTS. Темы статей, которые человеку стоит повторить, сервер считает
// по сводке прогресса (тем же правилом, что страница прогресса и разбор ошибок):
// раздел такой темы, найденный по теме выше порога, идёт в материал (не больше
// MAX_REVIEW_FRAGMENTS) с пометкой и тем, что в ответе человека неверно (пометки кода), — без
// вопроса упражнения, ответа целиком и объяснения верного ответа. Упражнения банка и путешествия в материал не идут.
// Решения — docs/ai-decisions-log.md, раздел «Разбор ошибок и путешествие по теме».

const index = indexFile as SearchIndexFile;

// Разделы-переходы к следующей статье: по теме статьи они находятся вместе с остальными
// её разделами, а материала в них нет (DEV_NOTES.md, итерация 4)
const NAVIGATION_SECTIONS = new Set(["chto-dalshe", "itog-tsikla"]);
export const PORTAL_SECTIONS = index.chunks.filter((chunk) => chunk.kind === "section" && !NAVIGATION_SECTIONS.has(chunk.sectionId));

// Сколько разделов отдаётся плану и сколько источников бывает у чекпоинта
export const MAX_FRAGMENTS = 8;
const MAX_SOURCES_PER_CHECKPOINT = 3;
// Сколько разделов «стоит повторить» идёт в материал с пометкой: у каждого должен быть свой
// чекпоинт, а чекпоинтов в путешествии 3–5 — при шести и больше разделах с пометкой план
// не собирался никогда. Остальные разделы, если попали в материал, идут без пометки
export const MAX_REVIEW_FRAGMENTS = 3;
const EMBEDDING_TIMEOUT_MS = 10_000;

export type PortalFragment = PortalPromptFragment & {
  // section:<slug>#<якорь> — так фрагмент записан в сохранённых ответах (fixtures.ts)
  id: string;
  href: string;
};

export type PortalMaterial = { topic: string; fragments: PortalFragment[] };

export type PortalMaterialResult =
  | { ok: true; material: PortalMaterial }
  // Ничего выше порога: тема не о материалах портала, модель не вызывается
  | { ok: false; reason: "not-in-materials" }
  // Нет настроек эмбеддингов, индекс другой модели или сервис не ответил
  | { ok: false; reason: "unavailable" };

// Можно ли искать по смыслу: без модели эмбеддингов (или с индексом другой модели)
// путешествие по материалам портала недоступно — по словам без порога находились бы
// случайные совпадения
export function isPortalSearchConfigured(): boolean {
  const config = readEmbeddingConfig();
  return config !== null && index.model === config.model;
}

export async function findPortalMaterial(
  topic: string,
  progress: ProgressInput | undefined,
  abortSignal?: AbortSignal,
): Promise<PortalMaterialResult> {
  const config = readEmbeddingConfig();
  if (!config || index.model !== config.model) return { ok: false, reason: "unavailable" };
  let query: number[];
  try {
    [query] = await embedTexts(config, [QUERY_INSTRUCTION + topic], {
      abortSignal,
      timeoutMs: EMBEDDING_TIMEOUT_MS,
      maxRetries: 0,
    });
  } catch (error) {
    if (!abortSignal?.aborted) {
      console.error(`[journey] эмбеддинг темы не получен: ${describeEmbeddingError(error)}`);
    }
    return { ok: false, reason: "unavailable" };
  }

  const ranked = rankSemantic(
    PORTAL_SECTIONS.map((chunk) => chunk.embedding),
    query,
    MIN_SIMILARITY,
    PORTAL_SECTIONS.map((chunk) => chunk.headingEmbedding),
  );
  if (ranked.length === 0) return { ok: false, reason: "not-in-materials" };

  // Раздел темы, которую стоит повторить (до MAX_REVIEW_FRAGMENTS, от последних ошибок), — всегда
  // в материале: не попал в восьмёрку — встаёт вместо самого дальнего раздела без пометки
  const found = new Set(ranked.map((item) => keyOf(PORTAL_SECTIONS[item.index])));
  const review = reviewKeys(progress, found);
  const isReview = (i: number) => review.has(keyOf(PORTAL_SECTIONS[i]));
  const chosen = ranked.slice(0, MAX_FRAGMENTS).map((item) => item.index);
  for (const item of ranked.slice(MAX_FRAGMENTS)) {
    if (!isReview(item.index)) continue;
    const farthest = chosen.findLastIndex((i) => !isReview(i));
    if (farthest === -1) break;
    chosen.splice(farthest, 1);
    chosen.push(item.index);
  }
  // В порядке курса: материал читается, как статья
  chosen.sort((a, b) => a - b);
  return { ok: true, material: { topic, fragments: chosen.map((i) => toFragment(PORTAL_SECTIONS[i], progress, review)) } };
}

// Есть ли статья с разделами для «Путешествия по этой статье» — маршрут проверяет до лимита
export function isPortalArticle(slug: string): boolean {
  return PORTAL_SECTIONS.some((chunk) => chunk.articleSlug === slug);
}

// «Путешествие по этой статье» — материал из разделов одной статьи, без поиска: поиск по названию
// статьи подтягивал разделы соседних статей. Все разделы, кроме переходов, в порядке статьи и до
// MAX_FRAGMENTS; если их больше, сначала не идёт вступление, затем разделы с конца — кроме разделов
// «стоит повторить» (их берёт reviewKeys — только из этой статьи). Модель эмбеддингов не нужна.
// null — такой статьи нет
export function articlePortalMaterial(
  slug: string,
  topic: string,
  progress: ProgressInput | undefined,
): PortalMaterial | null {
  const sections = PORTAL_SECTIONS.filter((chunk) => chunk.articleSlug === slug);
  if (sections.length === 0) return null;
  const review = reviewKeys(progress, new Set(sections.map(keyOf)));
  const isReview = (chunk: IndexedChunk) => review.has(keyOf(chunk));
  const chosen = [...sections];
  const intro = chosen.findIndex((chunk) => chunk.sectionId === "" && !isReview(chunk));
  if (chosen.length > MAX_FRAGMENTS && intro !== -1) chosen.splice(intro, 1);
  while (chosen.length > MAX_FRAGMENTS) {
    const last = chosen.findLastIndex((chunk) => !isReview(chunk));
    if (last === -1) break;
    chosen.splice(last, 1);
  }
  return { topic, fragments: chosen.map((chunk) => toFragment(chunk, progress, review)) };
}

// Материал по сохранённым id фрагментов — сохранённые ответы (fixtures.ts) собираются
// без сервиса эмбеддингов. Пометки «стоит повторить» — по присланной сводке, как обычно
export function portalMaterialFromIds(topic: string, ids: string[], progress: ProgressInput | undefined): PortalMaterial {
  const chunks = ids.flatMap((id) => PORTAL_SECTIONS.filter((item) => item.id === id));
  const review = reviewKeys(progress, new Set(chunks.map(keyOf)));
  const fragments = chunks.map((chunk) => toFragment(chunk, progress, review));
  return { topic, fragments };
}

const keyOf = (chunk: IndexedChunk) => `${chunk.articleSlug}#${chunk.sectionId}`;

// Темы, которые стоит повторить, среди найденных (found) — не больше MAX_REVIEW_FRAGMENTS,
// в порядке последних ошибок сводки
function reviewKeys(progress: ProgressInput | undefined, found: Set<string>): Set<string> {
  if (!progress) return new Set();
  return new Set(
    reviewArticleTopics(progress)
      .map((topic) => topic.key)
      .filter((key) => found.has(key))
      .slice(0, MAX_REVIEW_FRAGMENTS),
  );
}

function toFragment(chunk: IndexedChunk, progress: ProgressInput | undefined, review: Set<string>): PortalFragment {
  const prefix = `${chunk.path.join(" › ")}\n\n`;
  const fragment: PortalFragment = {
    id: chunk.id,
    path: chunk.path,
    href: `/articles/${chunk.articleSlug}${chunk.sectionId ? `#${chunk.sectionId}` : ""}`,
    text: chunk.text.startsWith(prefix) ? chunk.text.slice(prefix.length) : chunk.text,
  };
  if (!progress || !review.has(keyOf(chunk))) return fragment;
  // Упражнения темы, последний ответ на которые неверный или частичный
  const results = latestResults(progress);
  const topic = getAllTopics().find((item) => item.key === keyOf(chunk));
  fragment.review = (topic?.exerciseIds ?? []).flatMap((id) => {
    const exercise = getExercise(id);
    const verdict = results.get(id);
    if (!exercise || !verdict || verdict === "correct") return [];
    const mistake = progress.mistakes.find((item) => item.id === id);
    return [
      {
        answer: mistake ? describeAnswer(exercise, mistake.answer) : null,
        errors: mistake ? answerErrors(exercise, mistake.answer) : null,
        beliefs: mistake ? wrongBeliefs(exercise, mistake.answer) : [],
      },
    ];
  });
  return fragment;
}

// Что человек по ошибке счёл верным — готовые заблуждения для чекпоинта темы: выбранный
// неверный вариант и неверное утверждение, оценённое как верное. Их ставит в план код
// (checkPortalPlan): на проверке модель дописывала к ответу человека своё объяснение,
// а в «свой» чекпоинт клала бессмыслицу вместо него. У пар и шагов готовой фразы нет —
// там неверное описывают пометки кода, а заблуждение пишет модель
function wrongBeliefs(exercise: Exercise, answer: unknown): string[] {
  const record = (answer ?? {}) as Record<string, unknown>;
  if (exercise.type === "multiple-choice" && Array.isArray(record.selected)) {
    const selected: unknown[] = record.selected;
    return exercise.options
      .filter((option) => selected.includes(option.id) && !exercise.correct.includes(option.id))
      .map((option) => option.text);
  }
  if (exercise.type === "true-false" && typeof record.answers === "object" && record.answers !== null) {
    const answers = record.answers as Record<string, unknown>;
    return exercise.statements.filter((statement) => answers[statement.id] === true && !statement.isTrue).map((statement) => statement.text);
  }
  return [];
}

// Номера фрагментов «стоит повторить» — с единицы, по списку материала
export function reviewNumbers(material: PortalMaterial): number[] {
  return material.fragments.flatMap((fragment, i) => (fragment.review ? [i + 1] : []));
}

// Фраза по-английски: три латинских слова и больше, и латинских букв больше, чем русских.
// Термин латиницей («LLM», «JSON») в русской фразе — не повод
function isEnglish(text: string): boolean {
  const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0;
  return count(/\p{Script=Latin}{2,}/gu) >= 3 && count(/\p{Script=Latin}/gu) > count(/\p{Script=Cyrillic}/gu);
}

// Фраза — хотя бы два слова из букв
const isSentence = (text: string) => (text.match(/\p{L}{2,}/gu)?.length ?? 0) >= 2;

// Ключевые факты и заблуждения — карточка для шага упражнений, человек их не видит. Модель
// писала их по-английски, однажды — запятыми вместо фактов: такая строка отбрасывается
// по одной, а не отклоняет весь план. Ошибкой плана это становится, только если фактов осталось
// меньше двух (checkPlan). Видимый текст — название, понятие, конспект, упражнения — код не правит
// и шаг из-за него не повторяет: латинская буква в слове или английская фраза — сбой модели,
// а не промпта, как и в путешествии по своей теме (решение владельца)
function dropUnreadableFacts(plan: PortalPlan): PortalPlan {
  const readable = (text: string) => isSentence(text) && !isEnglish(text);
  return {
    ...plan,
    checkpoints: plan.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      keyFacts: checkpoint.keyFacts.filter(readable),
      misconceptions: checkpoint.misconceptions.filter(readable),
    })),
  };
}

// Заблуждения своего чекпоинта раздела «стоит повторить»: то, что человек по ошибке счёл
// верным, — первым; то же самое другими словами, которое модель записала сама («Она ищет…» —
// «Модель ищет…»), убирается; заблуждений не больше трёх, как в плане
const MAX_MISCONCEPTIONS = 3;
function withBeliefs(misconceptions: string[], main: PortalFragment): string[] {
  const beliefs = (main.review ?? []).flatMap((item) => item.beliefs);
  if (beliefs.length === 0) return misconceptions;
  const rest = misconceptions.filter((item) => !beliefs.some((belief) => isSameIdea(belief, item)));
  return [...beliefs, ...rest].slice(0, Math.max(MAX_MISCONCEPTIONS, beliefs.length));
}

// Почти те же слова: не меньше 70% значимых слов короткой фразы есть в другой
function isSameIdea(a: string, b: string): boolean {
  const words = (text: string) => new Set(normalizeText(text).match(/\p{L}{3,}/gu) ?? []);
  const [left, right] = [words(a), words(b)];
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared >= 0.7 * Math.min(left.size, right.size);
}

export type CheckedPortalPlan = { plan: Plan; sources: CheckpointSource[][] };

// Проверка плана по материалам портала. Номера — как checkAnswer в поиске: номер, которого
// не было среди фрагментов, убирается, больше трёх — лишние отбрасываются; чекпоинт без годного
// номера и раздел «стоит повторить» без своего чекпоинта — ошибка плана (текст уходит модели
// при повторе). Что можно поправить кодом, код правит сам (английские факты — dropUnreadableFacts, раздел
// «стоит повторить» вторым источником, лишние чекпоинты, пустые отметки типов, заблуждения
// человека). Возвращает план в общем виде (без сомнительных утверждений: материал — статьи
// портала) и источники чекпоинтов — ссылки строит код
export function checkPortalPlan(
  original: PortalPlan,
  material: PortalMaterial,
): { ok: true; value: CheckedPortalPlan } | { ok: false; error: string } {
  const cleaned = dropUnreadableFacts(original);
  const count = material.fragments.length;
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= count;
  let checkpoints = cleaned.checkpoints.map((checkpoint) => ({
    ...checkpoint,
    sources: [...new Set(checkpoint.sources.filter(valid))].slice(0, MAX_SOURCES_PER_CHECKPOINT),
    // На проверке модель вернула пустые отметки типов: «выбор ответа» подходит многим понятиям
    suitableTypes: checkpoint.suitableTypes.length > 0 ? checkpoint.suitableTypes : (["multiple-choice"] as const).slice(),
  }));
  const empty = checkpoints.findIndex((checkpoint) => checkpoint.sources.length === 0);
  if (empty !== -1) {
    return { ok: false, error: `чекпоинт ${empty + 1}: в sources нет номеров фрагментов из списка (от 1 до ${count})` };
  }

  // «Свой» чекпоинт раздела, который стоит повторить, — тот, где его номер первый в sources.
  // Если раздел есть в источниках чекпоинта не первым, а первым там стоит раздел без пометки,
  // код ставит его первым: модель так и писала план, где раздел — второй источник чекпоинта о нём
  const review = reviewNumbers(material);
  for (const n of review) {
    if (checkpoints.some((checkpoint) => checkpoint.sources[0] === n)) continue;
    const host = checkpoints.find((checkpoint) => checkpoint.sources.includes(n) && !review.includes(checkpoint.sources[0]));
    if (host) host.sources = [n, ...host.sources.filter((item) => item !== n)];
  }
  const missed = review.filter((n) => !checkpoints.some((checkpoint) => checkpoint.sources[0] === n));
  if (missed.length > 0) {
    return {
      ok: false,
      error: `у фрагмент${missed.length > 1 ? "ов" : "а"} ${missed.map((n) => `[${n}]`).join(", ")} с пометкой «Стоит повторить» нет своего чекпоинта — номер такого фрагмента должен стоять первым в sources чекпоинта о нём`,
    };
  }

  // Чекпоинтов больше пяти (на проверке модель сделала по чекпоинту на каждый из 8 фрагментов):
  // лишние с конца отбрасываются, кроме своих чекпоинтов разделов «стоит повторить»; зависимости
  // перенумеровываются, а на отброшенные — убираются
  if (checkpoints.length > CHECKPOINTS_MAX) {
    const isOwn = (i: number) =>
      review.includes(checkpoints[i].sources[0]) && checkpoints.findIndex((item) => item.sources[0] === checkpoints[i].sources[0]) === i;
    const kept: number[] = [];
    const own = checkpoints.map((_, i) => i).filter(isOwn);
    for (const [i] of checkpoints.entries()) {
      if (isOwn(i) || kept.length + own.filter((j) => j > i).length < CHECKPOINTS_MAX) kept.push(i);
    }
    const renumber = new Map(kept.map((old, i) => [old + 1, i + 1]));
    checkpoints = kept.map((old) => ({
      ...checkpoints[old],
      dependsOn: checkpoints[old].dependsOn.flatMap((dep) => (renumber.has(dep) ? [renumber.get(dep)!] : [])),
    }));
  }
  const plan = { ...cleaned, checkpoints };
  const numbers = checkpoints.map((checkpoint) => checkpoint.sources);
  return {
    ok: true,
    value: {
      plan: {
        suitable: plan.suitable,
        problem: plan.problem,
        title: plan.title,
        doubts: [],
        // Лишнее поле sources дальше не читается: источники — отдельно, по проверенным номерам
        // Заблуждения человека — только в первый чекпоинт, где раздел стоит первым
        checkpoints: plan.checkpoints.map((checkpoint, i) => ({
          ...checkpoint,
          misconceptions:
            numbers.findIndex((list) => list[0] === numbers[i][0]) === i
              ? withBeliefs(checkpoint.misconceptions, material.fragments[numbers[i][0] - 1])
              : checkpoint.misconceptions,
        })),
      },
      sources: numbers.map((list) =>
        list.map((n) => ({ path: material.fragments[n - 1].path, href: material.fragments[n - 1].href })),
      ),
    },
  };
}
