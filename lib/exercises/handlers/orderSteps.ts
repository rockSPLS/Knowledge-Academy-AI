import { z } from "zod";
import { MAX_ANSWER_ITEMS, MAX_ID_LENGTH, validateItemIds } from "../limits";
import { verdictFromScore } from "../scoring";
import type {
  CheckResult,
  OrderStepsExercise,
  OrderStepsReview,
  PublicOrderSteps,
} from "../types";

// Серверная логика упражнения «Расставьте шаги»: пользователь выстраивает шаги по порядку.
//
// Оценка — по тому, сколько шагов нужно переставить до верного порядка.
// Шаги, которые трогать не нужно, — это самая длинная цепочка шагов, уже стоящих
// в верном порядке относительно друг друга (не обязательно подряд). Остальные — переставить.
// Балл: 0 перестановок — 1; полностью обратный порядок (n − 1 перестановок) — 0.

export function toPublic(exercise: OrderStepsExercise): PublicOrderSteps {
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    // В авторском (перемешанном) порядке; верный порядок и пояснения остаются на сервере
    steps: exercise.steps.map(({ id, text }) => ({ id, text })),
  };
}

export const answerSchema = z.object({
  order: z.array(z.string().max(MAX_ID_LENGTH)).max(MAX_ANSWER_ITEMS),
});

// Проверка целостности упражнения в банке; возвращает текст ошибки или null
export function validate(exercise: OrderStepsExercise): string | null {
  const count = exercise.steps.length;
  if (count < 3 || count > 6) return "должно быть от 3 до 6 шагов";
  const stepIds = exercise.steps.map((step) => step.id);
  const idsError = validateItemIds(stepIds, "шагов");
  if (idsError) return idsError;
  if (!isPermutationOf(exercise.correct, stepIds)) {
    return "верный порядок должен содержать каждый шаг ровно один раз";
  }
  // Защита от ошибки автора: пользователь не должен увидеть шаги сразу в верном порядке
  if (stepIds.every((id, index) => exercise.correct[index] === id)) {
    return "шаги показываются уже в верном порядке — перемешайте их";
  }
  return null;
}

// Возвращает null, если прислан не полный порядок шагов этого упражнения
// (не все шаги, лишние или неизвестные id, повторы)
export function check(
  exercise: OrderStepsExercise,
  answer: z.infer<typeof answerSchema>,
): CheckResult<OrderStepsReview> | null {
  if (!isPermutationOf(answer.order, exercise.correct)) return null;

  // Номер каждого шага в верном порядке (с 0)
  const correctIndex = new Map(exercise.correct.map((id, index) => [id, index]));
  const positions = answer.order.map((id) => correctIndex.get(id) ?? 0);
  const keep = longestIncreasingIndices(positions);

  const total = exercise.correct.length;
  const moves = total - keep.size;
  const score = (keep.size - 1) / (total - 1);
  const verdict = verdictFromScore(score);

  const feedbackById = new Map(exercise.steps.map((step) => [step.id, step.feedback]));
  const steps: OrderStepsReview["steps"] = {};
  answer.order.forEach((id, index) => {
    const isCorrect = keep.has(index);
    const position = (correctIndex.get(id) ?? 0) + 1;
    const feedback = feedbackById.get(id);
    // Пояснение показываем у шагов, которые нужно переставить
    steps[id] = !isCorrect && feedback ? { isCorrect, position, feedback } : { isCorrect, position };
  });

  return {
    score,
    verdict,
    // Называет только число перестановок, но не сами шаги. Формулировка нейтральная:
    // до раскрытия ответа это подсказка, после — итог, совпадающий с отметками у шагов
    hint:
      verdict === "correct" ? undefined : `Нужно переставить ${moves} ${pluralSteps(moves)}.`,
    review: {
      explanation: exercise.explanation,
      details: { type: "order-steps", steps },
    },
  };
}

// Содержит ли список каждый id из эталона ровно один раз и ничего лишнего
function isPermutationOf(list: string[], reference: string[]): boolean {
  if (list.length !== reference.length || new Set(list).size !== list.length) return false;
  const allowed = new Set(reference);
  return list.every((id) => allowed.has(id));
}

// Индексы самой длинной возрастающей подпоследовательности: шаги, которые уже стоят
// в верном порядке относительно друг друга. Шагов не больше шести, поэтому простой
// перебор «каждый с каждым» (n²) достаточен.
function longestIncreasingIndices(values: number[]): Set<number> {
  // length[i] — длина самой длинной цепочки, которая заканчивается на элементе i;
  // previous[i] — предыдущий элемент этой цепочки
  const length = values.map(() => 1);
  const previous = values.map(() => -1);
  let best = 0;
  for (let i = 0; i < values.length; i++) {
    for (let j = 0; j < i; j++) {
      if (values[j] < values[i] && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1;
        previous[i] = j;
      }
    }
    if (length[i] > length[best]) best = i;
  }
  const result = new Set<number>();
  for (let i = best; i !== -1; i = previous[i]) result.add(i);
  return result;
}

// «1 шаг», «2 шага», «5 шагов»
function pluralSteps(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return "шаг";
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "шага";
  return "шагов";
}
