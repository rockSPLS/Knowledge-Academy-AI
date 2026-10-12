"use client";

import { useState } from "react";
import type { CheckResult } from "@/lib/exercises/types";
import { useTestContext } from "@/components/test/TestContext";

// Общая логика любого упражнения: отправить ответ на проверку,
// хранить статус и результат, сообщить результат тесту (если упражнение в тесте).
// Каждый тип упражнения использует этот хук и добавляет только свой способ ввода ответа.

export type ExerciseStatus = "idle" | "checking" | "checked" | "error";
export type ExerciseMode = "inline" | "test";

export function useExercise<TAnswer>(exerciseId: string) {
  const test = useTestContext();
  const [status, setStatus] = useState<ExerciseStatus>("idle");
  const [result, setResult] = useState<CheckResult | null>(null);

  async function submit(answer: TAnswer) {
    setStatus("checking");
    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId, answer }),
        // Если сервер не ответил за 10 секунд — показываем ошибку, а не вечное «Проверяю…»
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const checked: CheckResult = await response.json();
      setResult(checked);
      setStatus("checked");
      test?.report(exerciseId, checked);
    } catch {
      setStatus("error");
    }
  }

  function reset() {
    setResult(null);
    setStatus("idle");
  }

  const mode: ExerciseMode = test ? "test" : "inline";
  return { status, result, submit, reset, mode };
}
