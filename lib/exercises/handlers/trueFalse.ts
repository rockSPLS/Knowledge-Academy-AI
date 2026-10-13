import { z } from "zod";
import { MAX_ANSWER_ITEMS, MAX_ID_LENGTH, validateItemIds } from "../limits";
import { verdictFromScore } from "../scoring";
import type { CheckResult, PublicTrueFalse, TrueFalseExercise, TrueFalseReview } from "../types";

// Серверная логика упражнения «Верно или неверно»: несколько утверждений,
// каждое пользователь оценивает как верное или неверное.

export function toPublic(exercise: TrueFalseExercise): PublicTrueFalse {
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    // Только id и текст: правильная оценка и объяснение остаются на сервере
    statements: exercise.statements.map(({ id, text }) => ({ id, text })),
  };
}

export const answerSchema = z.object({
  answers: z
    .record(z.string().max(MAX_ID_LENGTH), z.boolean())
    .refine((record) => Object.keys(record).length <= MAX_ANSWER_ITEMS),
});

// Проверка целостности упражнения в банке; возвращает текст ошибки или null
export function validate(exercise: TrueFalseExercise): string | null {
  const count = exercise.statements.length;
  if (count < 1 || count > 5) return "должно быть от 1 до 5 утверждений";
  return validateItemIds(
    exercise.statements.map((statement) => statement.id),
    "утверждений",
  );
}

// Балл = доля верно оценённых утверждений.
// Возвращает null, если оценены не все утверждения или есть лишние id.
export function check(
  exercise: TrueFalseExercise,
  answer: z.infer<typeof answerSchema>,
): CheckResult<TrueFalseReview> | null {
  const given = Object.keys(answer.answers);
  const ids = new Set(exercise.statements.map((statement) => statement.id));
  if (given.length !== ids.size || !given.every((id) => ids.has(id))) return null;

  const statements: TrueFalseReview["statements"] = {};
  let correctCount = 0;
  for (const statement of exercise.statements) {
    const isCorrect = answer.answers[statement.id] === statement.isTrue;
    if (isCorrect) correctCount++;
    // Объяснение показываем там, где пользователь ошибся
    statements[statement.id] = isCorrect
      ? { isCorrect, isTrue: statement.isTrue }
      : { isCorrect, isTrue: statement.isTrue, explanation: statement.explanation };
  }

  const total = exercise.statements.length;
  const score = correctCount / total;
  const verdict = verdictFromScore(score);

  return {
    score,
    verdict,
    hint: buildHint(verdict, correctCount, total),
    review: {
      explanation: exercise.explanation,
      details: { type: "true-false", statements },
    },
  };
}

// Подсказка не называет, какие именно утверждения оценены неверно
function buildHint(
  verdict: CheckResult["verdict"],
  correctCount: number,
  total: number,
): string | undefined {
  if (verdict === "partial") return `Верно оценено ${correctCount} из ${total}.`;
  if (verdict === "incorrect" && total > 1) return "Ни одно утверждение не оценено верно.";
  return undefined;
}
