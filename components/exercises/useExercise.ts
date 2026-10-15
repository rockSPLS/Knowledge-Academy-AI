"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckResult } from "@/lib/exercises/types";
import { useTestContext } from "@/components/test/TestContext";

// Общая логика любого упражнения: отправить ответ на проверку,
// хранить статус и результат, раскрыть ответ по запросу,
// в тесте — сообщать черновик ответа и результат, отправлять ответ по «Завершить тест».
// Каждый тип упражнения использует этот хук и добавляет только свой способ ввода ответа.

export type ExerciseStatus = "idle" | "checking" | "checked" | "revealing" | "error";
export type ExerciseMode = "inline" | "test";

// Текущий ответ, который пользователь ещё не отправил. answer — готовый к отправке ответ
// или null, если он заполнен не полностью; touched — пользователь уже начал отвечать.
// В тесте по нему считаются «Готово N из M» и пропущенные вопросы, и по нему же
// кнопка «Завершить тест» отправляет ответ.
export type ExerciseDraft<TAnswer> = {
  answer: TAnswer | null;
  touched: boolean;
};

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

export function useExercise<TAnswer>(exerciseId: string, draft: ExerciseDraft<TAnswer>) {
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

  // ---------- Тест: черновик и отправка по кнопке «Завершить тест» ----------

  const setDraft = test?.setDraft;
  const registerSubmitter = test?.registerSubmitter;
  const ready = draft.answer !== null;
  const { touched } = draft;

  // Сообщаем тесту, заполнен ли ответ и начат ли он
  useEffect(() => {
    setDraft?.(exerciseId, { ready, touched });
  }, [setDraft, exerciseId, ready, touched]);

  // Последние ответ, статус и функция отправки — для кнопки «Завершить тест»,
  // которая вызывает отправку позже, уже после перерисовок
  const latest = useRef({ answer: draft.answer, status, submit });
  useEffect(() => {
    latest.current = { answer: draft.answer, status, submit };
  });

  useEffect(() => {
    if (!registerSubmitter) return;
    return registerSubmitter(exerciseId, async () => {
      const { answer, status: current, submit: send } = latest.current;
      // Не заполнен или уже отправлен — отправлять нечего; после ошибки сети — пробуем снова
      if (answer === null || (current !== "idle" && current !== "error")) return;
      await send(answer);
    });
  }, [registerSubmitter, exerciseId]);

  // В тесте итог и разбор скрыты до завершения теста: тест — проверка себя,
  // а разбор по ходу подсказывал бы ответы на похожие вопросы дальше.
  // Сам результат уже отправлен в тест — он нужен для счёта.
  const visibleResult = test && !test.isFinished ? null : result;

  return { status, result: visibleResult, revealError, submit, revealAnswer, reset, mode };
}
