"use client";

import { useEffect, useRef } from "react";
import type { CheckResult, Verdict } from "@/lib/exercises/types";
import type { ExerciseMode, ExerciseStatus } from "./useExercise";

// Итог всегда обозначается значком и словом, а не только цветом —
// так его различают и люди, которые плохо различают цвета (требование доступности WCAG).
// Цвета временные — финальное оформление выбирается на шаге дизайна.
const VERDICTS: Record<Verdict, { icon: string; label: string; className: string }> = {
  correct: { icon: "✓", label: "Верно", className: "text-green-700 dark:text-green-400" },
  partial: { icon: "◐", label: "Частично верно", className: "text-amber-700 dark:text-amber-400" },
  incorrect: { icon: "✗", label: "Неверно", className: "text-red-700 dark:text-red-400" },
};

// Общая оболочка для всех типов упражнений: метка типа, вопрос, кнопка
// проверки и блок результата. Поле для ответа передаётся через children —
// его рисует конкретный тип упражнения (он же подсвечивает варианты при разборе).

type ExerciseShellProps = {
  typeLabel: string;
  question: string;
  status: ExerciseStatus;
  result: CheckResult | null;
  revealError: boolean;
  mode: ExerciseMode;
  canSubmit: boolean;
  onSubmit: () => void;
  onRetry: () => void;
  onReveal: () => void;
  children: React.ReactNode;
};

export function ExerciseShell({
  typeLabel,
  question,
  status,
  result,
  revealError,
  mode,
  canSubmit,
  onSubmit,
  onRetry,
  onReveal,
  children,
}: ExerciseShellProps) {
  const isAnswered = status === "checked" || status === "revealing";
  const isChecking = status === "checking";
  const isRevealing = status === "revealing";
  const resultRef = useRef<HTMLDivElement>(null);
  const revealErrorRef = useRef<HTMLParagraphElement>(null);

  // Кнопки исчезают и появляются — переводим фокус на результат после проверки
  // и после раскрытия ответа, чтобы клавиатура и экранный диктор не «потерялись».
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  // Если раскрыть ответ не удалось — фокус на сообщение об ошибке
  useEffect(() => {
    if (revealError) revealErrorRef.current?.focus();
  }, [revealError]);

  const verdict = result ? VERDICTS[result.verdict] : null;
  const canReveal = mode === "inline" && result && !result.review;

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

      <div className="mt-4 space-y-3">
        {!isAnswered && (
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

        {isAnswered && result && verdict && (
          <div ref={resultRef} tabIndex={-1} className="space-y-2 text-sm outline-none">
            <p className={`font-medium ${verdict.className}`}>
              <span aria-hidden="true">{verdict.icon} </span>
              {verdict.label}
            </p>
            {result.hint && <p>{result.hint}</p>}
            {result.review && (
              <>
                <p className="text-foreground/70">{result.review.explanation}</p>
                {/* Для экранных дикторов: отметки «верно / лишний / пропущен» стоят у вариантов выше */}
                <p className="sr-only">Разбор по каждому элементу ответа отмечен выше.</p>
              </>
            )}
            {revealError && (
              <p ref={revealErrorRef} role="alert" tabIndex={-1} className="outline-none">
                Не удалось загрузить ответ. Попробуйте ещё раз.
              </p>
            )}

            {mode === "inline" && (
              <div className="flex flex-wrap gap-4 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (!isRevealing) onRetry();
                  }}
                  aria-disabled={isRevealing}
                  className="underline underline-offset-4 aria-disabled:opacity-50"
                >
                  Попробовать ещё раз
                </button>
                {canReveal && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isRevealing) onReveal();
                    }}
                    // aria-disabled вместо disabled: заблокированная кнопка сохраняет фокус
                    aria-disabled={isRevealing}
                    className="underline underline-offset-4 aria-disabled:opacity-50"
                  >
                    {isRevealing ? "Загружаю ответ…" : "Показать ответ"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
