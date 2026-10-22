import type { PublicExercise } from "@/lib/exercises/types";
import type { Difficulty, PublicCheckpoint } from "./types";

// Время на чекпоинт — сумма норм его упражнений. Норма упражнения: время на вопрос
// плюс время на каждый элемент (вариант, утверждение, пропуск, пару, шаг),
// умноженное на коэффициент сложности. Файл без server-only: время считает браузер
// по публичной части путешествия. Числа — начальные, уточняются по ручным прохождениям.

// Время на вопрос и на один элемент ответа, секунд
const NORMS: Record<PublicExercise["type"], { base: number; perItem: number }> = {
  "multiple-choice": { base: 20, perItem: 8 },
  "true-false": { base: 10, perItem: 12 },
  "fill-blank": { base: 15, perItem: 15 },
  "match-pairs": { base: 15, perItem: 12 },
  "order-steps": { base: 15, perItem: 10 },
  // Подумать и написать 2–5 предложений; элементов ответа нет
  "free-answer": { base: 120, perItem: 0 },
  // Сгенерированных упражнений этих типов пока нет — нормы на будущее
  "costed-select": { base: 30, perItem: 10 },
  "prompt-rewrite": { base: 180, perItem: 0 },
};

const DIFFICULTY_FACTOR: Record<Difficulty, number> = { 1: 1, 2: 1.3, 3: 1.6 };

// Время чекпоинта округляется вверх до 15 секунд: «2:00» читается лучше, чем «1:54»
const ROUND_TO_SEC = 15;

function itemCount(exercise: PublicExercise): number {
  switch (exercise.type) {
    case "multiple-choice":
      return exercise.options.length;
    case "true-false":
      return exercise.statements.length;
    case "fill-blank":
      return exercise.parts.filter((part) => part.type === "blank").length;
    case "match-pairs":
      return exercise.terms.length;
    case "order-steps":
      return exercise.steps.length;
    case "costed-select":
      return exercise.options.length;
    case "prompt-rewrite":
    case "free-answer":
      return 0;
  }
}

export function exerciseSeconds(exercise: PublicExercise, difficulty: Difficulty): number {
  const { base, perItem } = NORMS[exercise.type];
  return (base + perItem * itemCount(exercise)) * DIFFICULTY_FACTOR[difficulty];
}

export function checkpointSeconds(checkpoint: PublicCheckpoint): number {
  const total = checkpoint.exercises.reduce(
    (sum, { exercise, difficulty }) => sum + exerciseSeconds(exercise, difficulty),
    0,
  );
  return Math.ceil(total / ROUND_TO_SEC) * ROUND_TO_SEC;
}

// «1:05», «12:00»
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
