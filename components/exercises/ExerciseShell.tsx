"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, CircleMinus, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import type { CheckResult, Verdict } from "@/lib/exercises/types";
import type { ExerciseMode, ExerciseStatus } from "./useExercise";

// Итог всегда обозначается значком и словом, а не только цветом —
// так его различают и люди, которые плохо различают цвета (требование доступности WCAG).
// Зелёный, янтарный и красный зарезервированы за итогами и больше нигде не используются —
// поэтому технические ошибки (нет сети) оформлены нейтрально, чтобы их не путали с «Неверно».
const VERDICTS: Record<Verdict, { Icon: LucideIcon; label: string; className: string }> = {
  correct: { Icon: CircleCheck, label: "Верно", className: "text-success" },
  partial: { Icon: CircleMinus, label: "Частично верно", className: "text-warning" },
  incorrect: { Icon: CircleX, label: "Неверно", className: "text-danger" },
};

// Второстепенные кнопки после неверного ответа. «Попробовать ещё раз» чуть заметнее
// (мягкий индиго): сначала подталкиваем подумать ещё раз, а не подсмотреть ответ.
// Заполненный индиго остаётся только у главного действия — «Проверить».
const SECONDARY_BUTTON =
  "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors aria-disabled:opacity-50";
const RETRY_BUTTON = `${SECONDARY_BUTTON} border-transparent bg-accent-soft text-accent-soft-foreground hover:border-accent`;
const REVEAL_BUTTON = `${SECONDARY_BUTTON} border-border-strong bg-background hover:bg-border`;

// Общая оболочка для всех типов упражнений: метка типа, вопрос, инструкция,
// кнопка проверки и блок результата. Поле для ответа передаётся через children —
// его рисует конкретный тип упражнения (он же подсвечивает варианты при разборе).
// Все типы выглядят одинаково и различаются значком и названием типа.

type ExerciseShellProps = {
  typeName: string;
  typeIcon: LucideIcon;
  question: string;
  // Что нужно сделать, например «Выберите один ответ»
  instruction: string;
  status: ExerciseStatus;
  result: CheckResult | null;
  revealError: boolean;
  mode: ExerciseMode;
  // Сообщение, если ответ заполнен не полностью (тип показывает его после попытки проверить).
  // Кнопка «Проверить» не блокируется: по клику видно, чего не хватает.
  validationMessage: string | null;
  onSubmit: () => void;
  onRetry: () => void;
  onReveal: () => void;
  children: React.ReactNode;
};

export function ExerciseShell({
  typeName,
  typeIcon: TypeIcon,
  question,
  instruction,
  status,
  result,
  revealError,
  mode,
  validationMessage,
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
  // Номер попытки проверить: сообщение о незаполненном пересоздаётся при каждом клике,
  // чтобы экранный диктор озвучивал его снова, даже если текст не изменился
  const [submitAttempt, setSubmitAttempt] = useState(0);

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
  // Повтор и раскрытие имеют смысл, только пока ответ не раскрыт:
  // после верного ответа и после «Показать ответ» кнопок нет
  const canRetryOrReveal = mode === "inline" && result !== null && !result.review;

  return (
    <section className="my-8 rounded-xl border border-border bg-surface p-5">
      {/* fieldset + legend связывают варианты ответа с вопросом для экранных дикторов */}
      <fieldset>
        <legend className="w-full">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent-soft-foreground">
            <TypeIcon size={14} aria-hidden="true" />
            {typeName}
          </span>
          <span className="mt-4 block font-semibold">{question}</span>
          <span className="mt-1 block text-sm text-muted">{instruction}</span>
        </legend>
        <div className="mt-4">{children}</div>
      </fieldset>

      <div className="mt-4 space-y-3">
        {!isAnswered && (
          <button
            type="button"
            onClick={() => {
              if (isChecking) return;
              setSubmitAttempt((n) => n + 1);
              onSubmit();
            }}
            aria-disabled={isChecking}
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover aria-disabled:opacity-60"
          >
            {isChecking ? "Проверяю…" : "Проверить"}
          </button>
        )}

        {/* Нейтральное оформление: красный и янтарный закреплены за итогами */}
        {validationMessage && !isAnswered && (
          <p key={submitAttempt} role="alert" className="inline-flex items-center gap-1.5 text-sm">
            <TriangleAlert size={16} aria-hidden="true" className="text-accent" />
            {validationMessage}
          </p>
        )}

        {status === "error" && (
          <p role="alert" className="inline-flex items-center gap-1.5 text-sm">
            <TriangleAlert size={16} aria-hidden="true" className="text-muted" />
            Не удалось проверить ответ. Попробуйте ещё раз.
          </p>
        )}

        {isAnswered && result && verdict && (
          <div ref={resultRef} tabIndex={-1} className="space-y-2 text-sm outline-none">
            {/* Строка итога растянута на всю ширину: справа позже может появиться награда */}
            <div className="flex items-center justify-between gap-4">
              <p className={`inline-flex items-center gap-1.5 font-semibold ${verdict.className}`}>
                <verdict.Icon size={18} aria-hidden="true" />
                {verdict.label}
              </p>
            </div>
            {result.hint && <p>{result.hint}</p>}
            {result.retryHint && !result.review && <p>{result.retryHint}</p>}
            {result.review && (
              <>
                <p className="text-muted">{result.review.explanation}</p>
                {/* Для экранных дикторов: отметки «верно / лишний / пропущен» стоят у вариантов выше */}
                <p className="sr-only">Разбор по каждому элементу ответа отмечен выше.</p>
              </>
            )}
            {revealError && (
              <p
                ref={revealErrorRef}
                role="alert"
                tabIndex={-1}
                className="inline-flex items-center gap-1.5 outline-none"
              >
                <TriangleAlert size={16} aria-hidden="true" className="text-muted" />
                Не удалось загрузить ответ. Попробуйте ещё раз.
              </p>
            )}

            {canRetryOrReveal && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (!isRevealing) onRetry();
                  }}
                  aria-disabled={isRevealing}
                  className={RETRY_BUTTON}
                >
                  Попробовать ещё раз
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isRevealing) onReveal();
                  }}
                  // aria-disabled вместо disabled: заблокированная кнопка сохраняет фокус
                  aria-disabled={isRevealing}
                  className={REVEAL_BUTTON}
                >
                  {isRevealing ? "Загружаю ответ…" : "Показать ответ"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
