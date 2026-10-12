import "server-only";
import type { CheckResult, Exercise, PublicExercise } from "./types";
import * as multipleChoice from "./handlers/multipleChoice";

// Единая точка серверной работы с упражнениями. Каждый тип описан своим
// обработчиком в handlers/, здесь они только выбираются по полю `type`.

export function toPublicExercise(exercise: Exercise): PublicExercise {
  switch (exercise.type) {
    case "multiple-choice":
      return multipleChoice.toPublic(exercise);
  }
}

// Проверяет ответ и решает, раскрывать ли правильный ответ.
// Правило одно для всех типов: разбор отдаётся, если ответ полностью верный
// или если раскрытие запрошено явно (кнопка «Показать ответ» или режим теста).
// Возвращает null, если ответ не подходит для этого упражнения
// (неверный формат, варианты, которых в упражнении нет, или отмечено больше вариантов, чем верных)
export function checkAnswer(
  exercise: Exercise,
  answer: unknown,
  reveal: boolean,
): CheckResult | null {
  const result = evaluate(exercise, answer);
  if (!result) return null;
  if (reveal || result.verdict === "correct") return result;
  const withoutReview = { ...result };
  delete withoutReview.review;
  return withoutReview;
}

function evaluate(exercise: Exercise, answer: unknown): CheckResult | null {
  switch (exercise.type) {
    case "multiple-choice": {
      const parsed = multipleChoice.answerSchema.safeParse(answer);
      return parsed.success ? multipleChoice.check(exercise, parsed.data) : null;
    }
  }
}
