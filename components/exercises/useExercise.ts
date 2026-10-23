"use client";

import { useEffect, useRef, useState } from "react";
import type { CheckResult } from "@/lib/exercises/types";
import { useTestContext } from "@/components/test/TestContext";
import { useJourneyExercise } from "@/components/journey/JourneyExerciseContext";
import { JourneyApiError } from "@/components/journey/api";

// Общая логика любого упражнения: отправить ответ на проверку,
// хранить статус и результат, раскрыть ответ по запросу,
// в тесте — сообщать черновик ответа и результат, отправлять ответ по «Завершить тест»,
// в путешествии — проверять по зашифрованному путешествию, считать попытки
// и отправлять ответ как есть, когда время чекпоинта вышло.
// Каждый тип упражнения использует этот хук и добавляет только свой способ ввода ответа.

// skipped — путешествие: время вышло, а ответа не было (или свободный ответ пропущен
// без оценки); skipping — пропуск отправляется
export type ExerciseStatus =
  | "idle"
  | "checking"
  | "checked"
  | "revealing"
  | "error"
  | "skipping"
  | "skipped";
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

// unratedFallback — ответ, который оценивает ИИ (свободный ответ, калибровка): если оценить его
// не удалось, а время чекпоинта вышло, упражнение пропускается без оценки
// (ждать, пока модель снова станет доступна, некогда)
export function useExercise<TAnswer>(
  exerciseId: string,
  draft: ExerciseDraft<TAnswer>,
  options?: { unratedFallback?: boolean },
) {
  const test = useTestContext();
  const journey = useJourneyExercise();
  // Путешествие выглядит как статья: своя кнопка «Проверить» и итог сразу
  const mode: ExerciseMode = test ? "test" : "inline";
  const [status, setStatus] = useState<ExerciseStatus>("idle");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [revealError, setRevealError] = useState(false);
  // Путешествие: текст ошибки от сервера (например, «оценка сейчас недоступна»);
  // null — показать общее сообщение
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Последний отправленный ответ — нужен, чтобы по кнопке «Показать ответ»
  // сервер разобрал именно его (что отмечено верно, что лишнее, что пропущено)
  const lastAnswer = useRef<TAnswer | null>(null);
  // Путешествие: запрос, который идёт сейчас, — конец времени дожидается его
  const pending = useRef<Promise<boolean> | null>(null);

  // Возвращает true, если ответ принят (нужно для конца времени в путешествии)
  function submit(answer: TAnswer): Promise<boolean> {
    pending.current = sendAnswer(answer);
    return pending.current;
  }

  async function sendAnswer(answer: TAnswer): Promise<boolean> {
    setStatus("checking");
    setErrorMessage(null);
    lastAnswer.current = answer;
    try {
      if (journey) {
        // Последняя попытка (или время вышло) — сразу с разбором: больше попыток не будет
        const attempt = journey.attemptsUsed(exerciseId) + 1;
        const isLast = attempt >= journey.maxAttempts(exerciseId) || journey.readTimeUp();
        const checked = await journey.check(exerciseId, answer, isLast);
        journey.recordCheck(exerciseId, checked, attempt, answer);
        setResult(checked);
        setStatus("checked");
        // Время вышло, пока ответ проверялся, — второй попытки уже не будет
        if (!checked.review && journey.readTimeUp()) return await sendReveal();
        return true;
      }
      // В тесте ответ раскрывается сразу, в статье — только по запросу
      const checked = await requestCheck(exerciseId, answer, mode === "test");
      setResult(checked);
      setStatus("checked");
      test?.report(exerciseId, checked);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof JourneyApiError ? error.message : null);
      setStatus("error");
      return false;
    }
  }

  function revealAnswer(): Promise<boolean> {
    pending.current = sendReveal();
    return pending.current;
  }

  async function sendReveal(): Promise<boolean> {
    if (lastAnswer.current === null) return false;
    setStatus("revealing");
    setRevealError(false);
    try {
      if (journey) {
        const revealed = await journey.check(exerciseId, lastAnswer.current, true);
        // Раскрытие — не новая попытка: итог остаётся за последней
        journey.recordCheck(exerciseId, revealed, "same", lastAnswer.current);
        setResult(revealed);
      } else {
        setResult(await requestCheck(exerciseId, lastAnswer.current, true));
      }
    } catch {
      // Прежний результат остаётся, показываем сообщение — можно нажать ещё раз
      setRevealError(true);
      setStatus("checked");
      return false;
    }
    setStatus("checked");
    return true;
  }

  function reset() {
    lastAnswer.current = null;
    setResult(null);
    setRevealError(false);
    setStatus("idle");
  }

  // Путешествие: время вышло, а ответа нет — итог «не успели»
  // (или итог первой попытки, если она была). unrated — свободный ответ
  // пропущен без оценки, потому что модель недоступна
  function skip(unrated = false): Promise<boolean> {
    pending.current = sendSkip(unrated);
    return pending.current;
  }

  async function sendSkip(unrated: boolean): Promise<boolean> {
    if (!journey) return false;
    setStatus("skipping");
    setErrorMessage(null);
    try {
      // Без оценки пропускается уже написанный ответ — он сохранится с итогом
      await journey.skip(exerciseId, unrated, unrated ? (lastAnswer.current ?? undefined) : undefined);
      setStatus("skipped");
      return true;
    } catch (error) {
      setErrorMessage(
        error instanceof JourneyApiError
          ? error.message
          : "Не удалось пропустить упражнение. Попробуйте ещё раз.",
      );
      setStatus("error");
      return false;
    }
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

  // Последние ответ, статус и функции — для кнопки «Завершить тест» и для конца
  // времени в путешествии: они вызывают отправку позже, уже после перерисовок
  const latest = useRef({ answer: draft.answer, status, result, submit, revealAnswer, skip });
  useEffect(() => {
    latest.current = { answer: draft.answer, status, result, submit, revealAnswer, skip };
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

  // ---------- Путешествие: время чекпоинта вышло ----------

  const registerFinalizer = journey?.registerFinalizer;
  const outcomeFor = journey?.outcomeFor;
  const unratedFallback = options?.unratedFallback ?? false;

  // Когда время выйдет: заполненный ответ отправляется как есть, после неудачной
  // первой попытки раскрывается её разбор, без ответа — «не успели».
  // Ответ, который как раз проверяется, доделает submit (он смотрит readTimeUp) —
  // его дожидаемся. Возвращает true, если всё отправлено
  useEffect(() => {
    if (!registerFinalizer || !outcomeFor) return;
    return registerFinalizer(exerciseId, async () => {
      if (outcomeFor(exerciseId)) return true;
      const { answer, status: current, result: last } = latest.current;
      if (current === "idle" || current === "error") {
        if (answer === null) return latest.current.skip();
        const sent = await latest.current.submit(answer);
        return sent || !unratedFallback ? sent : latest.current.skip(true);
      }
      if (current === "checked" && last && !last.review) return latest.current.revealAnswer();
      if ((current === "checking" || current === "skipping" || current === "revealing") && pending.current) {
        const done = await pending.current;
        // Свободный ответ проверялся, когда время вышло, и оценить его не удалось — пропуск без оценки
        return done || !unratedFallback || current !== "checking" ? done : latest.current.skip(true);
      }
      return true;
    });
  }, [registerFinalizer, outcomeFor, exerciseId, unratedFallback]);

  // Ответ нельзя менять: он отправлен или, в путешествии, время вышло
  // (тогда ответ уходит как есть, даже если отправка не удалась и её повторяют)
  const locked = (status !== "idle" && status !== "error") || (journey?.isTimeUp ?? false);

  // В тесте итог и разбор скрыты до завершения теста: тест — проверка себя,
  // а разбор по ходу подсказывал бы ответы на похожие вопросы дальше.
  // Сам результат уже отправлен в тест — он нужен для счёта.
  const visibleResult = test && !test.isFinished ? null : result;

  return {
    status,
    result: visibleResult,
    revealError,
    errorMessage,
    submit,
    revealAnswer,
    reset,
    skip,
    mode,
    locked,
  };
}
