"use client";

import { Puzzle } from "lucide-react";
import type { PublicFreeAnswer } from "@/lib/exercises/types";
import { FreeAnswer } from "./FreeAnswer";

// Свободный ответ «Приведите свой пример»: пример, где проявляется понятие, и почему он подходит.
// Логика и разбор — общие (FreeAnswer.tsx), здесь только оформление вида.

export function OwnExample({ exercise }: { exercise: PublicFreeAnswer }) {
  return (
    <FreeAnswer
      exercise={exercise}
      typeName="Приведите свой пример"
      typeIcon={Puzzle}
      instruction="Придумайте свой пример — не из конспекта — и объясните, почему он подходит"
      placeholder="Опишите пример и коротко объясните его"
    />
  );
}
