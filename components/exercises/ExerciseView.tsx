"use client";

import type { PublicExercise } from "@/lib/exercises/types";
import { MultipleChoice } from "./types/MultipleChoice";

// Выбирает компонент по типу упражнения. Новый тип — новая ветка здесь.
// Явный тип возврата нужен, чтобы TypeScript ругался, если для нового типа
// забыли добавить ветку (иначе упражнение молча не отрисуется).

export function ExerciseView({ exercise }: { exercise: PublicExercise }): React.ReactElement {
  switch (exercise.type) {
    case "multiple-choice":
      return <MultipleChoice exercise={exercise} />;
  }
}
