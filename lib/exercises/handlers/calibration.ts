import { z } from "zod";
import {
  CALIBRATION_ITEMS_MAX,
  CALIBRATION_ITEMS_MIN,
  MAX_ANSWER_ITEMS,
  MAX_CALIBRATION_ANSWER_LENGTH,
  MAX_ID_LENGTH,
  validateItemIds,
} from "../limits";
import { verdictFromScore } from "../scoring";
import { normalizeText } from "../text";
import type {
  CalibrationExercise,
  CalibrationJudgement,
  CalibrationReview,
  CheckResult,
  PublicCalibration,
} from "../types";

// Серверная логика калибровки уверенности. Верен ли каждый ответ, решает модель
// (lib/journey/judge.ts); здесь из её оценки и отметок уверенности считается балл
// и собирается разбор, поэтому check — обычная функция без запросов.

// Очки за вопрос: уверенно и верно — 1, с сомнением и верно — 0,5, с сомнением и неверно — 0,
// уверенно и неверно — −1. Так честная отметка выгоднее всего: «Точно знаю» приносит
// больше, только если вы правы чаще, чем в двух случаях из трёх
const POINTS = {
  confidentCorrect: 1,
  unsureCorrect: 0.5,
  unsureWrong: 0,
  confidentWrong: -1,
};

export function toPublic(exercise: CalibrationExercise): PublicCalibration {
  // Без правильных ответов
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    items: exercise.items.map(({ id, question }) => ({ id, question })),
  };
}

export const answerSchema = z.object({
  answers: z
    .record(
      z.string().max(MAX_ID_LENGTH),
      z.object({ text: z.string().max(MAX_CALIBRATION_ANSWER_LENGTH), confident: z.boolean() }),
    )
    .refine((record) => Object.keys(record).length <= MAX_ANSWER_ITEMS),
});

export type CalibrationInput = z.infer<typeof answerSchema>;

// Проверка целостности упражнения; возвращает текст ошибки или null
export function validate(exercise: CalibrationExercise): string | null {
  const count = exercise.items.length;
  if (count < CALIBRATION_ITEMS_MIN || count > CALIBRATION_ITEMS_MAX) {
    return `должно быть от ${CALIBRATION_ITEMS_MIN} до ${CALIBRATION_ITEMS_MAX} вопросов`;
  }
  const idsError = validateItemIds(
    exercise.items.map((item) => item.id),
    "вопросов",
  );
  if (idsError) return idsError;
  if (exercise.items.some((item) => normalizeText(item.question) === "" || normalizeText(item.answer) === "")) {
    return "у каждого вопроса нужны текст и правильный ответ";
  }
  return null;
}

// Ответ подходит упражнению: ответы на все вопросы, без лишних id и пустых текстов.
// Проверяется до запроса к модели — неподходящий ответ ей не передаём
export function isCompleteAnswer(exercise: CalibrationExercise, answer: CalibrationInput): boolean {
  const given = Object.keys(answer.answers);
  const ids = new Set(exercise.items.map((item) => item.id));
  return (
    given.length === ids.size &&
    given.every((id) => ids.has(id)) &&
    Object.values(answer.answers).every((item) => normalizeText(item.text) !== "")
  );
}

// Тексты ответов в порядке вопросов — их видит модель-оценщик (без отметок уверенности,
// чтобы они не влияли на оценку)
export function answerTexts(exercise: CalibrationExercise, answer: CalibrationInput): string[] {
  return exercise.items.map((item) => answer.answers[item.id].text.trim());
}

// Балл — сумма очков за вопросы, делённая на их число, не ниже нуля.
// evaluation — оценка модели по каждому вопросу, в порядке вопросов
export function check(
  exercise: CalibrationExercise,
  answer: CalibrationInput,
  evaluation: CalibrationJudgement[],
): CheckResult<CalibrationReview> {
  const items: CalibrationReview["items"] = {};
  let points = 0;
  exercise.items.forEach((item, index) => {
    const { confident } = answer.answers[item.id];
    const { correct, feedback } = evaluation[index];
    if (correct) points += confident ? POINTS.confidentCorrect : POINTS.unsureCorrect;
    else points += confident ? POINTS.confidentWrong : POINTS.unsureWrong;
    items[item.id] = { correct, feedback, confident, expected: item.answer };
  });

  const total = exercise.items.length;
  const score = Math.max(0, points) / total;
  const verdict = verdictFromScore(score);
  return {
    score,
    verdict,
    hint: buildHint(Object.values(items), total),
    review: {
      explanation: exercise.explanation,
      details: { type: "calibration", items },
    },
  };
}

// Итог словами: сколько верных и где уверенность подвела. Подсказка не нужна,
// только если всё верно и уверенно
function buildHint(items: CalibrationReview["items"][string][], total: number): string | undefined {
  const correct = items.filter((item) => item.correct).length;
  const confidentWrong = items.filter((item) => item.confident && !item.correct).length;
  const unsureCorrect = items.filter((item) => !item.confident && item.correct).length;
  if (correct === total) {
    return unsureCorrect > 0 ? `Все ответы верны, но в ${unsureCorrect} из ${total} вы сомневались.` : undefined;
  }
  const parts = [`Верных ответов: ${correct} из ${total}.`];
  if (confidentWrong > 0) parts.push(`Уверенных ошибок: ${confidentWrong}.`);
  return parts.join(" ");
}
