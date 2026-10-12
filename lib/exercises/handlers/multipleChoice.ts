import { z } from "zod";
import { verdictFromScore } from "../scoring";
import type {
  ChoiceOptionStatus,
  CheckResult,
  MultipleChoiceExercise,
  MultipleChoiceReview,
  PublicMultipleChoice,
} from "../types";

// Серверная логика упражнения «Выбор ответа»: что отдать в браузер,
// как проверить формат ответа и как его оценить.

export function toPublic(exercise: MultipleChoiceExercise): PublicMultipleChoice {
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    // Только id и текст: пояснения к вариантам выдают правильный ответ
    options: exercise.options.map(({ id, text }) => ({ id, text })),
    maxSelections: exercise.correct.length,
  };
}

export const answerSchema = z.object({
  // Ограничения размера защищают сервер от заведомо мусорных запросов
  selected: z.array(z.string().max(32)).min(1).max(20),
});

// Правило оценки: отметить можно не больше вариантов, чем верных (N), поэтому
// «выбрать всё» невозможно и штрафы не нужны. Балл = найдено верных / N.
// Возвращает полный результат вместе с разбором — решение, показывать ли разбор,
// принимается в server.ts.
// Возвращает null, если ответ нарушает правила: неизвестные варианты или больше N отметок.
export function check(
  exercise: MultipleChoiceExercise,
  answer: z.infer<typeof answerSchema>,
): CheckResult<MultipleChoiceReview> | null {
  const optionIds = new Set(exercise.options.map((option) => option.id));
  const selected = new Set(answer.selected);
  if (![...selected].every((id) => optionIds.has(id))) return null;
  if (selected.size > exercise.correct.length) return null;

  const correct = new Set(exercise.correct);
  const total = correct.size;
  const found = [...selected].filter((id) => correct.has(id)).length;
  const hasWrong = found < selected.size;
  const score = found / total;
  const verdict = verdictFromScore(score);

  return {
    score,
    verdict,
    hint: buildHint({ verdict, found, total, hasWrong, selectedCount: selected.size }),
    review: {
      explanation: exercise.explanation,
      details: buildReview(exercise, selected, correct),
    },
  };
}

// Подсказка не называет конкретные варианты — только помогает понять, куда смотреть
function buildHint(params: {
  verdict: CheckResult["verdict"];
  found: number;
  total: number;
  hasWrong: boolean;
  selectedCount: number;
}): string | undefined {
  const { verdict, found, total, hasWrong, selectedCount } = params;
  if (verdict === "partial") {
    const progress = `Найдено ${found} из ${total} верных вариантов`;
    return hasWrong ? `${progress}, но не все отмеченные варианты верны.` : `${progress}.`;
  }
  if (verdict === "incorrect" && total > 1) {
    return selectedCount === 1 ? "Отмеченный вариант неверен." : "Отмеченные варианты неверны.";
  }
  return undefined;
}

function buildReview(
  exercise: MultipleChoiceExercise,
  selected: Set<string>,
  correct: Set<string>,
): MultipleChoiceReview {
  const options: MultipleChoiceReview["options"] = {};
  for (const option of exercise.options) {
    const status = optionStatus(selected.has(option.id), correct.has(option.id));
    options[option.id] = option.feedback ? { status, feedback: option.feedback } : { status };
  }
  return { type: "multiple-choice", options };
}

function optionStatus(isSelected: boolean, isCorrect: boolean): ChoiceOptionStatus {
  if (isSelected) return isCorrect ? "correct" : "wrong";
  return isCorrect ? "missed" : "neutral";
}
