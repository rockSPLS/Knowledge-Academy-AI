import "server-only";
import { z } from "zod";
import { CHECKPOINTS_MAX } from "@/lib/journey/build";
import { MAX_QUESTION_LENGTH } from "@/lib/llm/limits";
import {
  MAX_JOURNEY_TEXT,
  MAX_SAVED_JOURNEYS,
  MAX_SUMMARY_EXERCISES,
  MAX_SUMMARY_JOURNEY_CONCEPTS,
  MAX_SUMMARY_MASTERED_CONCEPTS,
  MAX_SUMMARY_MISTAKES,
  MAX_SUMMARY_TEXT,
} from "@/lib/progress/types";
import { JOURNEY_VECTOR_BASE64_LENGTH } from "./journeys";
import type { JourneySearchInput } from "./types";

// Запрос POST /api/search: вопрос, сохранённые путешествия и сводка прогресса.
// Строго проверяется только вопрос. Путешествия и сводка — из браузера, то есть внешние
// данные: форма и длины проверяются у каждой записи отдельно, и запись, которая не
// подошла, пропускается. Отказать во всём запросе нельзя: браузер пришлёт то же самое
// и при повторе, и поиск не работал бы совсем, пока человек не удалит прогресс.
// В промпт эти данные попадают между метками со случайной частью (prompts.ts)

const id = z.string().min(1).max(100);
const text = z.string().max(MAX_JOURNEY_TEXT);

const journeySchema = z.object({
  id,
  title: text,
  checkpoints: z.array(z.object({ id, title: text, concept: text, summary: text })).min(1).max(CHECKPOINTS_MAX),
  // Негодные векторы не отменяют путешествие: сервер посчитает их заново
  vectors: z
    .object({
      model: z.string().max(200),
      data: z.array(z.string().max(JOURNEY_VECTOR_BASE64_LENGTH)).max(CHECKPOINTS_MAX),
    })
    .optional()
    .catch(undefined),
});

const exerciseResultSchema = z.object({ id, verdict: z.enum(["correct", "partial", "incorrect"]) });
// Ответ — только в упражнениях с выбором; форму сервер проверяет схемой его типа
// при описании ответа словами (progress.ts), здесь — только размер
const mistakeSchema = exerciseResultSchema.extend({ answer: z.record(z.string().max(20), z.unknown()).optional() });
const summaryText = z.string().max(MAX_SUMMARY_TEXT);
// id путешествия нужен разбору ошибок (ссылка на путешествие); поиску — нет, поэтому необязателен
const journeyConceptSchema = z.object({ journeyId: id.optional(), journey: summaryText, concept: summaryText });

// Сводка прогресса после проверки (форма — как ProgressSummary, ответы ещё не разобраны по типам)
export type ProgressInput = {
  exercises: z.infer<typeof exerciseResultSchema>[];
  mistakes: z.infer<typeof mistakeSchema>[];
  journeyConcepts: z.infer<typeof journeyConceptSchema>[];
  masteredConcepts: z.infer<typeof journeyConceptSchema>[];
};

const questionSchema = z.object({ question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH) });

// Вопрос из тела запроса; null — вопроса нет или он длиннее предела
export function parseQuestion(body: unknown): string | null {
  const parsed = questionSchema.safeParse(body);
  return parsed.success ? parsed.data.question : null;
}

export type SearchContextInput = { journeys: JourneySearchInput[]; progress?: ProgressInput };

// Путешествия и сводка из тела запроса — только записи, которые подошли.
// label — чей это запрос, для лога: тем же разбором пользуется и разбор ошибок
export function parseSearchContext(body: unknown, label = "search"): SearchContextInput {
  const { journeys, progress } = isRecord(body) ? body : {};
  const dropped: string[] = [];
  const result: SearchContextInput = {
    journeys: validItems(journeySchema, journeys, MAX_SAVED_JOURNEYS, "путешествий", dropped),
  };
  if (isRecord(progress)) {
    result.progress = {
      exercises: validItems(exerciseResultSchema, progress.exercises, MAX_SUMMARY_EXERCISES, "ответов", dropped),
      mistakes: validItems(mistakeSchema, progress.mistakes, MAX_SUMMARY_MISTAKES, "ошибок", dropped),
      journeyConcepts: validItems(
        journeyConceptSchema,
        progress.journeyConcepts,
        MAX_SUMMARY_JOURNEY_CONCEPTS,
        "понятий",
        dropped,
      ),
      masteredConcepts: validItems(
        journeyConceptSchema,
        progress.masteredConcepts,
        MAX_SUMMARY_MASTERED_CONCEPTS,
        "усвоенных понятий",
        dropped,
      ),
    };
  } else if (progress !== undefined) {
    dropped.push("сводка прогресса");
  }
  if (dropped.length > 0) console.warn(`[${label}] пропущены данные из браузера, которые не подошли: ${dropped.join(", ")}`);
  return result;
}

// Записи списка, которые подошли под схему, — не больше max; сколько пропущено, пишется в dropped
export function validItems<T>(schema: z.ZodType<T>, value: unknown, max: number, name: string, dropped: string[]): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    dropped.push(`${name} — не список`);
    return [];
  }
  const items = value.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const kept = items.slice(0, max);
  if (kept.length < value.length) dropped.push(`${name} ${value.length - kept.length}`);
  return kept;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
