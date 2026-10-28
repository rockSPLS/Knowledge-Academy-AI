import "server-only";
import { checkAnswer } from "@/lib/exercises/server";
import type { Exercise } from "@/lib/exercises/types";

// Что в ответе человека неверно — для разбора ошибок (lib/review/) и блока «Прогресс» поиска.
// Пометки считает та же проверка, что оценивает ответ в статье (lib/exercises/server.ts):
// модель сравнивала ответ с верным сама и в порядке шагов, где не на месте был один шаг,
// пересказывала весь верный порядок, а верно оценённое утверждение называла ошибкой.
// Теперь в данных сказано, что именно не так, и модель называет только это.

// Текст в кавычках «…»; если он уже в них (вариант — пример фразы), вторые не нужны.
// Им же пишет ответ человека блок «Прогресс» (progress.ts)
export function quote(text: string): string {
  return text.startsWith("«") && text.endsWith("»") ? text : `«${text}»`;
}

// null — ответа нет, он не подходит к упражнению или это упражнение не с выбором
export function answerErrors(exercise: Exercise, answer: unknown): string | null {
  return answerMarks(exercise, answer)?.errors || null;
}

// Что в ответе неверно и что верно — для блока «Прогресс» поиска: верное названо прямо
// с пометкой «не ошибка», иначе модель называла ошибкой и верно оценённое утверждение.
// Пустая строка — таких частей нет; null — как у answerErrors
export function answerMarks(exercise: Exercise, answer: unknown): { errors: string; correct: string } | null {
  if (answer === undefined) return null;
  const details = checkAnswer(exercise, answer, true)?.review?.details;
  if (!details) return null;
  const parts: string[] = [];
  const right: string[] = [];
  switch (details.type) {
    case "multiple-choice":
      if (exercise.type !== "multiple-choice") return null;
      for (const option of exercise.options) {
        const status = details.options[option.id]?.status;
        if (status === "wrong") parts.push(`выбран неверный вариант ${quote(option.text)}`);
        if (status === "missed") parts.push(`не выбран верный вариант ${quote(option.text)}`);
        if (status === "correct") right.push(`выбран верный вариант ${quote(option.text)}`);
      }
      break;
    case "true-false":
      if (exercise.type !== "true-false") return null;
      for (const statement of exercise.statements) {
        const mark = details.statements[statement.id];
        if (mark && !mark.isCorrect) {
          parts.push(
            `${quote(statement.text)} оценено как ${mark.isTrue ? "неверное" : "верное"}, а оно ${mark.isTrue ? "верное" : "неверное"}`,
          );
        }
        if (mark?.isCorrect) right.push(`${quote(statement.text)} оценено верно — как ${mark.isTrue ? "верное" : "неверное"}`);
      }
      break;
    case "match-pairs":
      if (exercise.type !== "match-pairs") return null;
      for (const term of exercise.terms) {
        const mark = details.terms[term.id];
        const expected = exercise.definitions.find((definition) => definition.id === mark?.expected);
        if (mark && !mark.isCorrect && expected) parts.push(`к ${quote(term.text)} нужно ${quote(expected.text)}`);
        if (mark?.isCorrect && expected) right.push(`${quote(term.text)} → ${quote(expected.text)}`);
      }
      break;
    case "order-steps": {
      if (exercise.type !== "order-steps") return null;
      const order = (answer as { order: string[] }).order;
      order.forEach((id, i) => {
        const mark = details.steps[id];
        const step = exercise.steps.find((item) => item.id === id);
        if (mark && step && !mark.isCorrect) {
          parts.push(`шаг ${quote(step.text)} стоит ${i + 1}-м, а в верном порядке он ${mark.position}-й`);
        }
        if (mark?.isCorrect && step) right.push(`шаг ${quote(step.text)} можно не трогать: относительно остальных он стоит верно`);
      });
      break;
    }
    case "costed-select": {
      if (exercise.type !== "costed-select") return null;
      const versions = exercise.items.flatMap((item) => item.versions);
      const text = (id: string) => versions.find((version) => version.id === id)?.text;
      for (const [id, mark] of Object.entries(details.options)) {
        const option = text(id);
        if (!option) continue;
        if (mark.status === "noise" || mark.status === "duplicate") parts.push(`взято лишнее ${quote(option)}`);
        if (mark.status === "needed-long") parts.push(`взята длинная версия ${quote(option)}, хотя есть короче`);
        if (mark.status === "danger") parts.push(`взято то, что нельзя отдавать модели, — ${quote(option)}`);
        if (mark.status === "missed") parts.push(`не взято нужное ${quote(option)}`);
      }
      break;
    }
    default:
      return null;
  }
  return { errors: parts.join("; "), correct: right.join("; ") };
}
