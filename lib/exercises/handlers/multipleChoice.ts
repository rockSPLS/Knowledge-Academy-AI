import { z } from "zod";
import type { CheckResult, MultipleChoiceExercise, PublicMultipleChoice } from "../types";

// Серверная логика упражнения «Выбор ответа»: что отдать в браузер,
// как проверить формат ответа и как его оценить.

export function toPublic(exercise: MultipleChoiceExercise): PublicMultipleChoice {
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    options: exercise.options,
    multiple: exercise.correct.length > 1,
  };
}

export const answerSchema = z.object({
  // Ограничения размера защищают сервер от заведомо мусорных запросов
  selected: z.array(z.string().max(32)).min(1).max(20),
});

// Возвращает null, если в ответе есть варианты, которых нет в упражнении
export function check(
  exercise: MultipleChoiceExercise,
  answer: z.infer<typeof answerSchema>,
): CheckResult | null {
  const optionIds = new Set(exercise.options.map((option) => option.id));
  if (!answer.selected.every((id) => optionIds.has(id))) return null;

  const selected = new Set(answer.selected);
  const correct = new Set(exercise.correct);
  const isCorrect =
    selected.size === correct.size && [...selected].every((id) => correct.has(id));

  // Пока засчитывается только полностью верный ответ.
  // Правило для частично верных ответов (когда правильных вариантов несколько)
  // ещё предстоит выбрать.
  return {
    score: isCorrect ? 1 : 0,
    isCorrect,
    explanation: exercise.explanation,
  };
}
