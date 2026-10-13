"use client";

import type { PublicExercise } from "@/lib/exercises/types";
import { FillBlank } from "./types/FillBlank";
import { MatchPairs } from "./types/MatchPairs";
import { MultipleChoice } from "./types/MultipleChoice";
import { OrderSteps } from "./types/OrderSteps";
import { TrueFalse } from "./types/TrueFalse";

// Выбирает компонент по типу упражнения. Новый тип — новая ветка здесь.
// Явный тип возврата нужен, чтобы TypeScript ругался, если для нового типа
// забыли добавить ветку (иначе упражнение молча не отрисуется).

export function ExerciseView({ exercise }: { exercise: PublicExercise }): React.ReactElement {
  switch (exercise.type) {
    case "multiple-choice":
      return <MultipleChoice exercise={exercise} />;
    case "true-false":
      return <TrueFalse exercise={exercise} />;
    case "fill-blank":
      return <FillBlank exercise={exercise} />;
    case "match-pairs":
      return <MatchPairs exercise={exercise} />;
    case "order-steps":
      return <OrderSteps exercise={exercise} />;
  }
}
