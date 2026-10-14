"use client";

import { useRef, useState } from "react";
import type { CheckResult } from "@/lib/exercises/types";
import { useTestContext } from "@/components/test/TestContext";

// Общая логика любого упражнения: отправить ответ на проверку,
// хранить статус и результат, раскрыть ответ по запросу,
// сообщить результат тесту (если упражнение в тесте).
// Каждый тип упражнения использует этот хук и добавляет только свой способ ввода ответа.

export type ExerciseStatus = "idle" | "checking" | "checked" | "revealing" | "error";
export type ExerciseMode = "inline" | "test";

async function requestCheck(
  exerciseId: string,
  answer: unknown,
  reveal: boolean,
): Promise<CheckResult> {
  const response = await fetch("/api/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exerciseId, answer, reveal }),
    // Если сервер не ответил за 10 секунд — показываем ошибку, а не вечное ожидание
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function useExercise<TAnswer>(exerciseId: string) {
  const test = useTestContext();
  const mode: ExerciseMode = test ? "test" : "inline";
  const [status, setStatus] = useState<ExerciseStatus>("idle");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [revealError, setRevealError] = useState(false);
  // Последний отправленный ответ — нужен, чтобы по кнопке «Показать ответ»
  // сервер разобрал именно его (что отмечено верно, что лишнее, что пропущено)
  const lastAnswer = useRef<TAnswer | null>(null);

  async function submit(answer: TAnswer) {
    setStatus("checking");
    lastAnswer.current = answer;
    try {
      // В тесте ответ раскрывается сразу, в статье — только по запросу
      const checked = await requestCheck(exerciseId, answer, mode === "test");
      setResult(checked);
      setStatus("checked");
      test?.report(exerciseId, checked);
    } catch {
      setStatus("error");
    }
  }

  async function revealAnswer() {
    if (lastAnswer.current === null) return;
    setStatus("revealing");
    setRevealError(false);
    try {
      const revealed = await requestCheck(exerciseId, lastAnswer.current, true);
      setResult(revealed);
    } catch {
      // Прежний результат остаётся, показываем сообщение — можно нажать ещё раз
      setRevealError(true);
    }
    setStatus("checked");
  }

  function reset() {
    lastAnswer.current = null;
    setResult(null);
    setRevealError(false);
    setStatus("idle");
  }

  // В тесте итог и разбор скрыты, пока не отвечены все вопросы: тест — проверка себя,
  // а разбор по ходу подсказывал бы ответы на похожие вопросы дальше.
  // Сам результат уже отправлен в тест — он нужен для счёта.
  const visibleResult = test && !test.isFinished ? null : result;

  return { status, result: visibleResult, revealError, submit, revealAnswer, reset, mode };
}
