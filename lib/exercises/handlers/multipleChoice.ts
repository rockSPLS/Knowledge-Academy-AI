import { z } from "zod";
import { verdictFromScore } from "../scoring";
import type { CheckResult, MultipleChoiceExercise, PublicMultipleChoice } from "../types";

// Серверная логика упражнения «Выбор ответа»: что отдать в браузер,
// как проверить формат ответа и как его оценить.

export function toPublic(exercise: MultipleChoiceExercise): PublicMultipleChoice {
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    options: exercise.options,
    maxSelections: exercise.correct.length,
  };
}

export const answerSchema = z.object({
  // Ограничения размера защищают сервер от заведомо мусорных запросов
  selected: z.array(z.string().max(32)).min(1).max(20),
});

// Правило оценки: отметить можно не больше вариантов, чем верных (N), поэтому
// «выбрать всё» невозможно и штрафы не нужны. Балл = найдено верных / N.
// Возвращает null, если ответ нарушает правила: неизвестные варианты или больше N отметок.
export function check(
  exercise: MultipleChoiceExercise,
  answer: z.infer<typeof answerSchema>,
): CheckResult | null {
  const optionIds = new Set(exercise.options.map((option) => option.id));
  const selected = new Set(answer.selected);
  if (![...selected].every((id) => optionIds.has(id))) return null;
  if (selected.size > exercise.correct.length) return null;

  const found = exercise.correct.filter((id) => selected.has(id)).length;
  const score = found / exercise.correct.length;

  return {
    score,
    verdict: verdictFromScore(score),
    explanation: exercise.explanation,
  };
}
