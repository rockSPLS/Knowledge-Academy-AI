"use client";

import { PencilLine } from "lucide-react";
import type { PublicFreeAnswer } from "@/lib/exercises/types";
import { FreeAnswer } from "./FreeAnswer";

// Свободный ответ «Развёрнутый ответ»: объяснить понятие своими словами.
// Логика и разбор — общие (FreeAnswer.tsx), здесь только оформление вида.

export function ExplainAnswer({ exercise }: { exercise: PublicFreeAnswer }) {
  return (
    <FreeAnswer
      exercise={exercise}
      typeName="Развёрнутый ответ"
      typeIcon={PencilLine}
      instruction="Ответьте своими словами, в нескольких предложениях"
      placeholder="Напишите ответ своими словами"
    />
  );
}
