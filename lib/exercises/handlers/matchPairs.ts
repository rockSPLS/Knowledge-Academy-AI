import { z } from "zod";
import { MAX_ANSWER_ITEMS, MAX_ID_LENGTH, validateItemIds } from "../limits";
import { verdictFromScore } from "../scoring";
import type {
  CheckResult,
  MatchPairsExercise,
  MatchPairsReview,
  PublicMatchPairs,
} from "../types";

// Серверная логика упражнения «Соедините пары»: к каждому термину пользователь
// ставит одно определение из стопки.

export function toPublic(exercise: MatchPairsExercise): PublicMatchPairs {
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    // Без пояснений: они показываются только при разборе
    terms: exercise.terms.map(({ id, text }) => ({ id, text })),
    // В авторском порядке; правильные пары остаются на сервере
    definitions: exercise.definitions.map(({ id, text }) => ({ id, text })),
  };
}

export const answerSchema = z.object({
  matches: z
    .record(z.string().max(MAX_ID_LENGTH), z.string().max(MAX_ID_LENGTH))
    .refine((record) => Object.keys(record).length <= MAX_ANSWER_ITEMS),
});

// Проверка целостности упражнения в банке; возвращает текст ошибки или null
export function validate(exercise: MatchPairsExercise): string | null {
  const count = exercise.terms.length;
  // Минимум 3: при 2 парах первая пара определяет вторую, а запрет порядка
  // «как у терминов» оставил бы единственный порядок — сам ответ
  if (count < 3 || count > 6) return "должно быть от 3 до 6 пар";
  if (exercise.definitions.length !== count) {
    return "определений должно быть столько же, сколько терминов";
  }
  const termIds = exercise.terms.map((term) => term.id);
  const definitionIds = exercise.definitions.map((definition) => definition.id);
  const idsError =
    validateItemIds(termIds, "терминов") ?? validateItemIds(definitionIds, "определений");
  if (idsError) return idsError;

  // Каждому термину — ровно одно существующее определение, без повторов
  const correctTermIds = Object.keys(exercise.correct);
  if (correctTermIds.length !== count || !termIds.every((id) => Object.hasOwn(exercise.correct, id))) {
    return "правильные пары должны быть указаны для каждого термина";
  }
  const correctDefinitionIds = Object.values(exercise.correct);
  if (!correctDefinitionIds.every((id) => definitionIds.includes(id))) {
    return "в правильных парах указано несуществующее определение";
  }
  if (new Set(correctDefinitionIds).size !== count) {
    return "одно определение указано у двух терминов";
  }

  // Защита от ошибки автора: определения не должны идти в том же порядке, что и термины.
  // Запрещаем только полное совпадение: запрет любого совпадения на своей позиции
  // сам подсказывал бы ответ (при 3 парах из 6 порядков оставалось бы 2)
  if (exercise.terms.every((term, index) => definitionIds[index] === exercise.correct[term.id])) {
    return "определения идут в том же порядке, что и термины — перемешайте определения";
  }
  return null;
}

// Балл = доля верно соединённых пар.
// Возвращает null, если сопоставлены не все термины, есть лишние или неизвестные id
// или одно определение поставлено к двум терминам.
export function check(
  exercise: MatchPairsExercise,
  answer: z.infer<typeof answerSchema>,
): CheckResult<MatchPairsReview> | null {
  const given = Object.keys(answer.matches);
  const termIds = new Set(exercise.terms.map((term) => term.id));
  if (given.length !== termIds.size || !given.every((id) => termIds.has(id))) return null;
  const definitionIds = new Set(exercise.definitions.map((definition) => definition.id));
  const placed = Object.values(answer.matches);
  if (!placed.every((id) => definitionIds.has(id)) || new Set(placed).size !== placed.length) {
    return null;
  }

  const terms: MatchPairsReview["terms"] = {};
  let correctCount = 0;
  for (const term of exercise.terms) {
    const expected = exercise.correct[term.id];
    const isCorrect = answer.matches[term.id] === expected;
    if (isCorrect) correctCount++;
    // Пояснение показываем там, где пользователь ошибся
    terms[term.id] =
      !isCorrect && term.feedback
        ? { isCorrect, expected, feedback: term.feedback }
        : { isCorrect, expected };
  }

  const total = exercise.terms.length;
  const score = correctCount / total;
  const verdict = verdictFromScore(score);

  return {
    score,
    verdict,
    hint: buildHint(verdict, correctCount, total),
    review: {
      explanation: exercise.explanation,
      details: { type: "match-pairs", terms },
    },
  };
}

// Подсказка не называет, какие именно пары соединены неверно
function buildHint(
  verdict: CheckResult["verdict"],
  correctCount: number,
  total: number,
): string | undefined {
  if (verdict === "partial") return `Верно соединено пар: ${correctCount} из ${total}.`;
  if (verdict === "incorrect") return "Ни одна пара не соединена верно.";
  return undefined;
}
