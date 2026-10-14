import { z } from "zod";
import { MAX_PROMPT_LENGTH, validateItemIds } from "../limits";
import { verdictFromScore } from "../scoring";
import { normalizeText } from "../text";
import type {
  CheckResult,
  PromptRewriteExercise,
  PromptRewriteReview,
  PublicPromptRewrite,
} from "../types";

// Серверная логика упражнения «Улучшите промпт»: пользователь переписывает слабый промпт,
// а сервер ищет в тексте признаки сильного промпта по рубрике. Без ИИ: признаки —
// регулярные выражения, поэтому проверка прозрачна, но необычную формулировку может не узнать.

export function toPublic(exercise: PromptRewriteExercise): PublicPromptRewrite {
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    // Без рубрики и образца: названия признаков подсказывали бы, что дописать
    weakPrompt: exercise.weakPrompt,
    weakAnswer: exercise.weakAnswer,
  };
}

export const answerSchema = z.object({
  text: z.string().max(MAX_PROMPT_LENGTH),
});

// Какие признаки рубрики есть в тексте
function findCriteria(exercise: PromptRewriteExercise, text: string): boolean[] {
  const normalized = normalizeText(text);
  return exercise.criteria.map((criterion) =>
    criterion.patterns.some((pattern) => pattern.test(normalized)),
  );
}

// Проверка целостности упражнения в банке; возвращает текст ошибки или null.
// Заодно проверяет саму рубрику: образец обязан пройти все признаки,
// а слабый промпт и условие задачи — ни одного, иначе шаблоны составлены неверно
export function validate(exercise: PromptRewriteExercise): string | null {
  const count = exercise.criteria.length;
  if (count < 2 || count > 6) return "должно быть от 2 до 6 признаков";
  const idsError = validateItemIds(
    exercise.criteria.map((criterion) => criterion.id),
    "признаков",
  );
  if (idsError) return idsError;
  for (const criterion of exercise.criteria) {
    if (criterion.patterns.length === 0) return `у признака "${criterion.id}" нет шаблонов`;
    // Флаги g и y хранят позицию между вызовами test — повторная проверка дала бы другой итог
    if (criterion.patterns.some((pattern) => pattern.global || pattern.sticky)) {
      return `у признака "${criterion.id}" шаблон с флагом g или y`;
    }
  }
  if (normalizeText(exercise.weakPrompt) === "" || normalizeText(exercise.sample) === "") {
    return "пустой слабый промпт или образец";
  }
  if (exercise.sample.length > MAX_PROMPT_LENGTH) return "образец длиннее допустимого ответа";
  const sampleFound = findCriteria(exercise, exercise.sample);
  const missing = exercise.criteria.filter((_, index) => !sampleFound[index]);
  if (missing.length > 0) {
    return `образец не проходит признаки: ${missing.map((criterion) => criterion.id).join(", ")}`;
  }
  const weakFound = findCriteria(exercise, exercise.weakPrompt);
  if (weakFound.some(Boolean)) return "слабый промпт уже проходит часть признаков";
  // Скопированное условие не должно набирать баллы: признаки требуют того,
  // что человек добавляет от себя
  const questionFound = findCriteria(exercise, exercise.question);
  if (questionFound.some(Boolean)) return "условие задачи уже проходит часть признаков";
  return null;
}

// Балл = доля найденных признаков.
// Возвращает null для пустого текста (интерфейс такой не отправляет).
export function check(
  exercise: PromptRewriteExercise,
  answer: z.infer<typeof answerSchema>,
): CheckResult<PromptRewriteReview> | null {
  if (normalizeText(answer.text) === "") return null;

  const found = findCriteria(exercise, answer.text);
  const foundCount = found.filter(Boolean).length;
  const total = exercise.criteria.length;
  const score = foundCount / total;
  const verdict = verdictFromScore(score);

  return {
    score,
    verdict,
    hint: buildHint(verdict, foundCount, total),
    review: {
      explanation: exercise.explanation,
      details: {
        type: "prompt-rewrite",
        // Как добавить — только у ненайденных признаков
        criteria: exercise.criteria.map((criterion, index) =>
          found[index]
            ? { id: criterion.id, label: criterion.label, found: true }
            : { id: criterion.id, label: criterion.label, found: false, howTo: criterion.howTo },
        ),
        sample: exercise.sample,
      },
    },
  };
}

// Подсказка называет только число найденных признаков, но не сами признаки
function buildHint(
  verdict: CheckResult["verdict"],
  foundCount: number,
  total: number,
): string | undefined {
  if (verdict === "partial") {
    return `Найдено признаков сильного промпта: ${foundCount} из ${total}.`;
  }
  if (verdict === "incorrect") {
    return "Признаков сильного промпта не найдено — опишите свою ситуацию конкретно.";
  }
  return undefined;
}
