import { z } from "zod";
import {
  FREE_ANSWER_CRITERIA_MAX,
  FREE_ANSWER_CRITERIA_MIN,
  MAX_FREE_ANSWER_LENGTH,
  validateItemIds,
} from "../limits";
import { verdictFromScore } from "../scoring";
import { normalizeText } from "../text";
import {
  FREE_ANSWER_KINDS,
  type CheckResult,
  type FreeAnswerExercise,
  type FreeAnswerFeedback,
  type FreeAnswerReview,
  type PublicFreeAnswer,
} from "../types";

// Серверная логика свободного ответа. Сам ответ оценивает модель (lib/journey/judge.ts):
// по каждому критерию — выполнен или нет и короткий отзыв. Здесь из этой оценки
// считается балл и собирается разбор, поэтому check — обычная функция без запросов.

export function toPublic(exercise: FreeAnswerExercise): PublicFreeAnswer {
  // Без критериев и образца: они подсказывали бы, что написать
  return { id: exercise.id, type: exercise.type, kind: exercise.kind, question: exercise.question };
}

export const answerSchema = z.object({
  text: z.string().max(MAX_FREE_ANSWER_LENGTH),
});

export type FreeAnswerInput = z.infer<typeof answerSchema>;

// Проверка целостности упражнения; возвращает текст ошибки или null
export function validate(exercise: FreeAnswerExercise): string | null {
  if (!(FREE_ANSWER_KINDS as readonly string[]).includes(exercise.kind)) {
    return "неизвестный вид свободного ответа";
  }
  const count = exercise.criteria.length;
  if (count < FREE_ANSWER_CRITERIA_MIN || count > FREE_ANSWER_CRITERIA_MAX) {
    return `должно быть от ${FREE_ANSWER_CRITERIA_MIN} до ${FREE_ANSWER_CRITERIA_MAX} критериев`;
  }
  const idsError = validateItemIds(
    exercise.criteria.map((criterion) => criterion.id),
    "критериев",
  );
  if (idsError) return idsError;
  if (exercise.criteria.some((criterion) => normalizeText(criterion.text) === "")) {
    return "пустой критерий";
  }
  if (normalizeText(exercise.sample) === "") return "пустой образец ответа";
  return null;
}

// Пустой ответ интерфейс не отправляет, а модели его не передаём
export function isBlankAnswer(answer: FreeAnswerInput): boolean {
  return normalizeText(answer.text) === "";
}

// Балл — доля выполненных критериев. evaluation — оценка модели, по одному
// элементу на критерий, в порядке критериев (judge.ts проверяет номера и упорядочивает)
export function check(
  exercise: FreeAnswerExercise,
  evaluation: FreeAnswerFeedback[],
): CheckResult<FreeAnswerReview> {
  const metCount = evaluation.filter((item) => item.met).length;
  const total = exercise.criteria.length;
  const score = metCount / total;
  const verdict = verdictFromScore(score);
  return {
    score,
    verdict,
    hint: verdict === "correct" ? undefined : `Выполнено критериев: ${metCount} из ${total}.`,
    feedback: evaluation,
    review: {
      explanation: exercise.explanation,
      details: {
        type: "free-answer",
        criteria: exercise.criteria.map((criterion, index) => ({
          id: criterion.id,
          text: criterion.text,
          ...evaluation[index],
        })),
        sample: exercise.sample,
      },
    },
  };
}
