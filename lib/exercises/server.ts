import "server-only";
import type { CheckResult, Exercise, PublicExercise } from "./types";
import * as multipleChoice from "./handlers/multipleChoice";
import * as trueFalse from "./handlers/trueFalse";
import * as fillBlank from "./handlers/fillBlank";
import * as matchPairs from "./handlers/matchPairs";
import * as orderSteps from "./handlers/orderSteps";
import * as costedSelect from "./handlers/costedSelect";
import * as promptRewrite from "./handlers/promptRewrite";
import * as freeAnswer from "./handlers/freeAnswer";
import * as calibration from "./handlers/calibration";

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
    case "match-pairs":
      return matchPairs.toPublic(exercise);
    case "order-steps":
      return orderSteps.toPublic(exercise);
    case "costed-select":
      return costedSelect.toPublic(exercise);
    case "prompt-rewrite":
      return promptRewrite.toPublic(exercise);
    case "free-answer":
      return freeAnswer.toPublic(exercise);
    case "calibration":
      return calibration.toPublic(exercise);
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
    case "match-pairs":
      return matchPairs.validate(exercise);
    case "order-steps":
      return orderSteps.validate(exercise);
    case "costed-select":
      return costedSelect.validate(exercise);
    case "prompt-rewrite":
      return promptRewrite.validate(exercise);
    case "free-answer":
      return freeAnswer.validate(exercise);
    case "calibration":
      return calibration.validate(exercise);
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
  return applyRevealRule(result, reveal);
}

// Общее правило раскрытия — отдельно, потому что свободный ответ и калибровка проверяются
// не через checkAnswer (их оценивает модель), а правило у них то же
export function applyRevealRule(result: CheckResult, reveal: boolean): CheckResult {
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
    case "match-pairs": {
      const parsed = matchPairs.answerSchema.safeParse(answer);
      return parsed.success ? matchPairs.check(exercise, parsed.data) : null;
    }
    case "order-steps": {
      const parsed = orderSteps.answerSchema.safeParse(answer);
      return parsed.success ? orderSteps.check(exercise, parsed.data) : null;
    }
    case "costed-select": {
      const parsed = costedSelect.answerSchema.safeParse(answer);
      return parsed.success ? costedSelect.check(exercise, parsed.data) : null;
    }
    case "prompt-rewrite": {
      const parsed = promptRewrite.answerSchema.safeParse(answer);
      return parsed.success ? promptRewrite.check(exercise, parsed.data) : null;
    }
    // Свободный ответ и калибровку оценивает модель, это запрос с лимитом частоты — его делает
    // маршрут путешествия (app/api/journey/exercise), а не общая проверка
    case "free-answer":
    case "calibration":
      return null;
  }
}
