import "server-only";
import { z } from "zod";
import {
  CALIBRATION_ITEMS_MAX,
  FREE_ANSWER_CRITERIA_MAX,
  MAX_CALIBRATION_ANSWER_LENGTH,
  MAX_FREE_ANSWER_LENGTH,
} from "@/lib/exercises/limits";
import { MAX_JOURNEY_TEXT } from "@/lib/progress/types";
import { parseSearchContext, validItems, type SearchContextInput } from "@/lib/search/request";
import { MAX_REVIEW_EXERCISES_PER_CONCEPT, MAX_REVIEW_ITEMS, type ReviewJourneyExercise } from "./types";

// Запрос POST /api/review: та же сводка и путешествия, что у поиска (lib/search/request.ts),
// и упражнения понятий путешествий с ошибкой (components/review/journeyExercises.ts).
// Упражнения — данные из браузера, поэтому каждая запись проверяется отдельно: запись
// не той формы или длиннее предела пропускается, остальные остаются. Пределы — как у полей
// ввода: свободный ответ — MAX_FREE_ANSWER_LENGTH, ответ калибровки — MAX_CALIBRATION_ANSWER_LENGTH,
// остальные строки — MAX_JOURNEY_TEXT. Записей — не больше, чем войдёт в разбор.
// В промпт они попадают внутри фрагмента понятия, между метками (prompts.ts)

const id = z.string().min(1).max(100);
const text = z.string().max(MAX_JOURNEY_TEXT);

const journeyExerciseSchema: z.ZodType<ReviewJourneyExercise> = z.object({
  journeyId: id,
  checkpointId: id,
  question: text,
  verdict: z.enum(["partial", "incorrect"]),
  skipped: z.boolean().optional(),
  answer: text.optional(),
  errors: text.optional(),
  text: z.string().max(MAX_FREE_ANSWER_LENGTH).optional(),
  criteria: z
    .array(z.object({ text, met: z.boolean(), feedback: text }))
    .max(FREE_ANSWER_CRITERIA_MAX)
    .optional(),
  items: z
    .array(
      z.object({
        question: text,
        answer: z.string().max(MAX_CALIBRATION_ANSWER_LENGTH),
        confident: z.boolean(),
        correct: z.boolean(),
        feedback: text,
        expected: text,
      }),
    )
    .max(CALIBRATION_ITEMS_MAX)
    .optional(),
  explanation: text,
});

const MAX_JOURNEY_EXERCISES = MAX_REVIEW_ITEMS * MAX_REVIEW_EXERCISES_PER_CONCEPT;

export type ReviewContextInput = SearchContextInput & { journeyExercises: ReviewJourneyExercise[] };

export function parseReviewContext(body: unknown, label = "review"): ReviewContextInput {
  const dropped: string[] = [];
  const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>).journeyExercises : undefined;
  const journeyExercises = validItems(journeyExerciseSchema, value, MAX_JOURNEY_EXERCISES, "упражнений путешествий", dropped);
  if (dropped.length > 0) console.warn(`[${label}] пропущены данные из браузера, которые не подошли: ${dropped.join(", ")}`);
  return { ...parseSearchContext(body, label), journeyExercises };
}
