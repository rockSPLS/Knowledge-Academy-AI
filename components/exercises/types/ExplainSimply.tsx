"use client";

import { Feather } from "lucide-react";
import type { PublicFreeAnswer } from "@/lib/exercises/types";
import { FreeAnswer } from "./FreeAnswer";

// Свободный ответ «Объясните простыми словами»: так, чтобы понял человек без подготовки.
// Логика и разбор — общие (FreeAnswer.tsx), здесь только оформление вида.

export function ExplainSimply({ exercise }: { exercise: PublicFreeAnswer }) {
  return (
    <FreeAnswer
      exercise={exercise}
      typeName="Объясните простыми словами"
      typeIcon={Feather}
      instruction="Объясните так, чтобы понял человек без подготовки: без терминов или с пояснением каждого"
      placeholder="Представьте, что объясняете человеку, который слышит об этом впервые"
    />
  );
}
