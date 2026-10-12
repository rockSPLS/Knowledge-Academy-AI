"use client";

import { useEffect, useRef } from "react";
import type { CheckResult, Verdict } from "@/lib/exercises/types";
import type { ExerciseMode, ExerciseStatus } from "./useExercise";

const VERDICT_LABELS: Record<Verdict, string> = {
  correct: "Верно",
  partial: "Частично верно",
  incorrect: "Неверно",
};

// Общая оболочка для всех типов упражнений: метка типа, вопрос, кнопка
// проверки и блок результата. Поле для ответа передаётся через children —
// его рисует конкретный тип упражнения.

type ExerciseShellProps = {
  typeLabel: string;
  question: string;
  status: ExerciseStatus;
  result: CheckResult | null;
  mode: ExerciseMode;
  canSubmit: boolean;
  onSubmit: () => void;
  onRetry: () => void;
  children: React.ReactNode;
};

export function ExerciseShell({
  typeLabel,
  question,
  status,
  result,
  mode,
  canSubmit,
  onSubmit,
  onRetry,
  children,
}: ExerciseShellProps) {
  const isChecked = status === "checked";
  const isChecking = status === "checking";
  const resultRef = useRef<HTMLDivElement>(null);

  // Кнопка «Проверить» исчезает после проверки — переводим фокус на результат,
  // чтобы клавиатура и экранный диктор не «потерялись» на странице.
  useEffect(() => {
    if (isChecked) resultRef.current?.focus();
  }, [isChecked]);

  return (
    <section className="my-8 rounded-lg border border-foreground/15 p-5">
      {/* fieldset + legend связывают варианты ответа с вопросом для экранных дикторов */}
      <fieldset>
        <legend className="w-full">
          <span className="block text-xs font-medium uppercase tracking-wide text-foreground/50">
            {typeLabel}
          </span>
          <span className="mt-4 block font-medium">{question}</span>
        </legend>
        <div className="mt-4">{children}</div>
      </fieldset>

      <div className="mt-4 space-y-2">
        {!isChecked && (
          <button
            type="button"
            onClick={() => {
              if (!isChecking) onSubmit();
            }}
            disabled={!canSubmit}
            aria-disabled={isChecking}
            className="rounded-md bg-foreground px-4 py-2 text-sm text-background disabled:opacity-40 aria-disabled:opacity-60"
          >
            {isChecking ? "Проверяю…" : "Проверить"}
          </button>
        )}

        {status === "error" && (
          <p role="alert" className="text-sm">
            Не удалось проверить ответ. Попробуйте ещё раз.
          </p>
        )}

        {/* Временный вид результата — оформление обратной связи ещё предстоит выбрать */}
        {isChecked && result && (
          <div ref={resultRef} tabIndex={-1} className="space-y-2 text-sm outline-none">
            <p className="font-medium">{VERDICT_LABELS[result.verdict]}</p>
            <p className="text-foreground/70">{result.explanation}</p>
            {mode === "inline" && (
              <button type="button" onClick={onRetry} className="underline underline-offset-4">
                Попробовать ещё раз
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
