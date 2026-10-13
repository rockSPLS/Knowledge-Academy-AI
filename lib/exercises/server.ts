import "server-only";
import type { CheckResult, Exercise, PublicExercise } from "./types";
import * as multipleChoice from "./handlers/multipleChoice";
import * as trueFalse from "./handlers/trueFalse";
import * as fillBlank from "./handlers/fillBlank";

// Единая точка серверной работы с упражнениями. Каждый тип описан своим
// обработчиком в handlers/, здесь они только выбираются по полю `type`.
// Новый тип — новая ветка в каждом switch (TypeScript напомнит, если забыть).

export function toPublicExercise(exercise: Exercise): PublicExercise {
  switch (exercise.type) {
    case "multiple-choice":
      return multipleChoice.toPublic(exercise);
    case "true-false":
      return trueFalse.toPublic(exercise);
    case "fill-blank":
      return fillBlank.toPublic(exercise);
  }
}

// Проверка целостности упражнения в банке; возвращает текст ошибки или null
export function validateExercise(exercise: Exercise): string | null {
  switch (exercise.type) {
    case "multiple-choice":
      return multipleChoice.validate(exercise);
    case "true-false":
      return trueFalse.validate(exercise);
    case "fill-blank":
      return fillBlank.validate(exercise);
  }
}

// Проверяет ответ и решает, раскрывать ли правильный ответ.
// Правило одно для всех типов: разбор отдаётся, если ответ полностью верный
// или если раскрытие запрошено явно (кнопка «Показать ответ» или режим теста).
// Возвращает null, если ответ не подходит для этого упражнения
// (неверный формат или не совпадает с устройством упражнения — см. check в обработчиках)
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
    case "true-false": {
      const parsed = trueFalse.answerSchema.safeParse(answer);
      return parsed.success ? trueFalse.check(exercise, parsed.data) : null;
    }
    case "fill-blank": {
      const parsed = fillBlank.answerSchema.safeParse(answer);
      return parsed.success ? fillBlank.check(exercise, parsed.data) : null;
    }
  }
}
