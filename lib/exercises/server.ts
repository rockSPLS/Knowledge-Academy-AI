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

// Возвращает null, если ответ не подходит для этого упражнения
// (неверный формат, варианты, которых в упражнении нет, или отмечено больше вариантов, чем верных)
export function checkAnswer(exercise: Exercise, answer: unknown): CheckResult | null {
  switch (exercise.type) {
    case "multiple-choice": {
      const parsed = multipleChoice.answerSchema.safeParse(answer);
      return parsed.success ? multipleChoice.check(exercise, parsed.data) : null;
    }
  }
}
