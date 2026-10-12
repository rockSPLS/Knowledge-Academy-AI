import type { Verdict } from "./types";

// Общие правила оценки для всех типов упражнений.
// Балл — доля правильно выполненных элементов ответа (найденные варианты,
// пары, пропуски) от 0 до 1. Итог всегда согласован с баллом.

export function verdictFromScore(score: number): Verdict {
  if (score >= 1) return "correct";
  if (score > 0) return "partial";
  return "incorrect";
}
