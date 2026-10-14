import { z } from "zod";
import { MAX_ANSWER_ITEMS, MAX_ID_LENGTH, validateItemIds } from "../limits";
import { verdictFromScore } from "../scoring";
import { normalizeText as normalize } from "../text";
import type {
  CheckResult,
  FillBlankExercise,
  FillBlankPart,
  FillBlankReview,
  PublicFillBlank,
} from "../types";

// Серверная логика упражнения «Заполните пропуски»: свободный ввод слов в текст.

// Пропуск в тексте записывается как [[id]]
const BLANK_PATTERN = /\[\[([a-z0-9-]+)\]\]/g;

// Разбивает текст на куски: обычный текст и пропуски
function splitText(text: string): FillBlankPart[] {
  const parts: FillBlankPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(BLANK_PATTERN)) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "blank", id: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ type: "text", value: text.slice(lastIndex) });
  return parts;
}

export function toPublic(exercise: FillBlankExercise): PublicFillBlank {
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    // Только текст и места пропусков: допустимые ответы остаются на сервере
    parts: splitText(exercise.text),
  };
}

export const answerSchema = z.object({
  blanks: z
    .record(z.string().max(MAX_ID_LENGTH), z.string().max(60))
    .refine((record) => Object.keys(record).length <= MAX_ANSWER_ITEMS),
});

// Проверка целостности упражнения в банке; возвращает текст ошибки или null
export function validate(exercise: FillBlankExercise): string | null {
  const parts = splitText(exercise.text);
  // Пропуск с ошибкой в разметке ([[Unit]], [[my_blank]]) остался бы в тексте как есть
  if (parts.some((part) => part.type === "text" && /\[\[|\]\]/.test(part.value))) {
    return "в тексте пропуск с неверной разметкой (id: строчные латинские буквы, цифры, дефис)";
  }
  const inText = parts.flatMap((part) => (part.type === "blank" ? [part.id] : []));
  if (inText.length === 0) return "в тексте нет ни одного пропуска [[id]]";
  const idsError = validateItemIds(inText, "пропусков");
  if (idsError) return idsError;
  const defined = Object.keys(exercise.blanks);
  if (
    defined.length !== inText.length ||
    !inText.every((id) => Object.hasOwn(exercise.blanks, id))
  ) {
    return "пропуски в тексте не совпадают с описанием пропусков";
  }
  for (const id of defined) {
    // Первый допустимый ответ показывается как эталон, поэтому он не может быть пустым
    const [first] = exercise.blanks[id].accepted;
    if (first === undefined || normalize(first) === "") {
      return `у пропуска "${id}" первый допустимый ответ пустой или отсутствует`;
    }
  }
  return null;
}

// Балл = доля верно заполненных пропусков.
// Возвращает null, если прислан не тот набор пропусков.
export function check(
  exercise: FillBlankExercise,
  answer: z.infer<typeof answerSchema>,
): CheckResult<FillBlankReview> | null {
  const ids = Object.keys(exercise.blanks);
  const given = Object.keys(answer.blanks);
  if (given.length !== ids.length || !ids.every((id) => Object.hasOwn(answer.blanks, id))) {
    return null;
  }

  const blanks: FillBlankReview["blanks"] = {};
  let correctCount = 0;
  let hasTypo = false;
  for (const id of ids) {
    const { accepted, feedback } = exercise.blanks[id];
    const value = normalize(answer.blanks[id]);
    const isCorrect = value !== "" && accepted.some((option) => normalize(option) === value);
    if (!isCorrect && accepted.some((option) => isLikelyTypo(value, normalize(option)))) {
      hasTypo = true;
    }
    if (isCorrect) correctCount++;
    // Эталон — первый допустимый ответ; пояснение — только у неверно заполненных
    blanks[id] =
      !isCorrect && feedback
        ? { isCorrect, expected: accepted[0], feedback }
        : { isCorrect, expected: accepted[0] };
  }

  const score = correctCount / ids.length;
  const verdict = verdictFromScore(score);

  return {
    score,
    verdict,
    hint: buildHint(verdict, correctCount, ids.length),
    // Не называет пропуск; «форма слова» — потому что близкий ответ может быть
    // верным словом в форме, которой нет в списке, а не опечаткой
    retryHint: hasTypo
      ? "Ответ очень близок к верному — проверьте написание и форму слова."
      : undefined,
    review: {
      explanation: exercise.explanation,
      details: { type: "fill-blank", blanks },
    },
  };
}

// Подсказка не называет, какие пропуски заполнены неверно
function buildHint(
  verdict: CheckResult["verdict"],
  correctCount: number,
  total: number,
): string | undefined {
  if (verdict === "partial") return `Верно заполнено пропусков: ${correctCount} из ${total}.`;
  if (verdict === "incorrect" && total > 1) return "Ни один пропуск не заполнен верно.";
  return undefined;
}

// Похоже ли значение на допустимый ответ с опечаткой: короткие слова не проверяем,
// у слов от 4 букв допускаем одно отличие, от 8 букв — два (вставка, удаление или замена буквы)
function isLikelyTypo(value: string, expected: string): boolean {
  if (expected.length < 4 || value === "") return false;
  const maxDistance = expected.length >= 8 ? 2 : 1;
  if (Math.abs(value.length - expected.length) > maxDistance) return false;
  return editDistance(value, expected) <= maxDistance;
}

// Расстояние редактирования (Левенштейна): сколько вставок, удалений и замен букв
// нужно, чтобы превратить одну строку в другую
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length];
}
