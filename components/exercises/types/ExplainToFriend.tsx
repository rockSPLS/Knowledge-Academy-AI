"use client";

import { MessagesSquare } from "lucide-react";
import type { PublicFreeAnswer } from "@/lib/exercises/types";
import { FreeAnswer } from "./FreeAnswer";

// Свободный ответ «Объясните другу»: друг верит в типичное заблуждение, его нужно переубедить.
// Логика и разбор — общие (FreeAnswer.tsx), здесь только оформление вида.

export function ExplainToFriend({ exercise }: { exercise: PublicFreeAnswer }) {
  return (
    <FreeAnswer
      exercise={exercise}
      typeName="Объясните другу"
      typeIcon={MessagesSquare}
      instruction="Объясните так, будто говорите с другом: чтобы он понял, в чём ошибается"
      placeholder="Напишите, что бы вы ему сказали"
    />
  );
}
