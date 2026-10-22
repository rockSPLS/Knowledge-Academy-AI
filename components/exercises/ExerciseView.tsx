"use client";

import type { PublicExercise, PublicFreeAnswer } from "@/lib/exercises/types";
import { Calibration } from "./types/Calibration";
import { CostedSelect } from "./types/CostedSelect";
import { ExplainAnswer } from "./types/ExplainAnswer";
import { ExplainSimply } from "./types/ExplainSimply";
import { ExplainToFriend } from "./types/ExplainToFriend";
import { FillBlank } from "./types/FillBlank";
import { MatchPairs } from "./types/MatchPairs";
import { MultipleChoice } from "./types/MultipleChoice";
import { OrderSteps } from "./types/OrderSteps";
import { OwnExample } from "./types/OwnExample";
import { PromptRewrite } from "./types/PromptRewrite";
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
    case "costed-select":
      return <CostedSelect exercise={exercise} />;
    case "prompt-rewrite":
      return <PromptRewrite exercise={exercise} />;
    case "free-answer":
      return <FreeAnswerView exercise={exercise} />;
    case "calibration":
      return <Calibration exercise={exercise} />;
  }
}

// Свободный ответ: у каждого вида задания свой компонент
function FreeAnswerView({ exercise }: { exercise: PublicFreeAnswer }): React.ReactElement {
  switch (exercise.kind) {
    case "explain":
      return <ExplainAnswer exercise={exercise} />;
    case "simple":
      return <ExplainSimply exercise={exercise} />;
    case "friend":
      return <ExplainToFriend exercise={exercise} />;
    case "example":
      return <OwnExample exercise={exercise} />;
  }
}
