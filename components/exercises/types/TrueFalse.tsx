"use client";

import { useId, useRef, useState } from "react";
import { ToggleRight } from "lucide-react";
import type { PublicTrueFalse, TrueFalseAnswer, TrueFalseReview } from "@/lib/exercises/types";
import { ExerciseShell } from "../ExerciseShell";
import { REVIEW_MARKS } from "../reviewMarks";
import { useExercise } from "../useExercise";

// Упражнение «Верно или неверно»: у каждого утверждения пользователь выбирает оценку.
// Проверить можно, когда оценены все утверждения.

const CHOICES = [
  { value: true, label: "Верно" },
  { value: false, label: "Неверно" },
] as const;

export function TrueFalse({ exercise }: { exercise: PublicTrueFalse }) {
  const { status, result, revealError, submit, revealAnswer, reset, mode } =
    useExercise<TrueFalseAnswer>(exercise.id);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  // Уникальный префикс имён групп, даже если упражнение встречается на странице дважды
  const groupPrefix = useId();
  const firstChoiceRef = useRef<HTMLInputElement>(null);
  // Пользователь пытался проверить, оценив не все утверждения — подсвечиваем пропущенные
  const [showMissing, setShowMissing] = useState(false);
  const isLocked = status !== "idle" && status !== "error";
  const isComplete = exercise.statements.every((statement) =>
    Object.hasOwn(answers, statement.id),
  );

  const details = result?.review?.details;
  const review: TrueFalseReview | null = details?.type === "true-false" ? details : null;

  function handleSubmit() {
    if (!isComplete) {
      setShowMissing(true);
      // Фокус — на первую радиокнопку первого неоценённого утверждения
      const missing = exercise.statements.find((s) => !Object.hasOwn(answers, s.id));
      if (missing) document.getElementById(`${groupPrefix}-${missing.id}-text-true`)?.focus();
      return;
    }
    submit({ answers });
  }

  function retry() {
    setShowMissing(false);
    setAnswers({});
    reset();
    requestAnimationFrame(() => firstChoiceRef.current?.focus());
  }

  return (
    <ExerciseShell
      typeName="Верно или неверно"
      typeIcon={ToggleRight}
      question={exercise.question}
      instruction={
        exercise.statements.length > 1
          ? "Оцените каждое утверждение"
          : "Оцените утверждение"
      }
      status={status}
      result={result}
      revealError={revealError}
      mode={mode}
      validationMessage={showMissing && !isComplete ? "Оцените все утверждения" : null}
      onSubmit={handleSubmit}
      onRetry={retry}
      onReveal={revealAnswer}
    >
      <ul className="space-y-2">
        {exercise.statements.map((statement, index) => {
          const statementReview = review?.statements[statement.id];
          const mark = statementReview
            ? REVIEW_MARKS[statementReview.isCorrect ? "correct" : "wrong"]
            : undefined;
          const textId = `${groupPrefix}-${statement.id}-text`;
          const isMissing = showMissing && !Object.hasOwn(answers, statement.id);

          return (
            <li
              key={statement.id}
              className={`rounded-lg border p-3 transition-colors ${
                mark
                  ? mark.box
                  : isMissing
                    ? "border-accent bg-background ring-1 ring-accent"
                    : "border-border bg-background"
              }`}
            >
              {/* На узком экране текст на всю ширину, кнопки — под ним; иначе текст сжимался
                  в столбик рядом с кнопками. С ширины sm — в одну строку */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span id={textId} className="min-w-0 sm:flex-1">
                  {statement.text}
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby={textId}
                  aria-invalid={isMissing || undefined}
                  className="flex gap-2"
                >
                  {CHOICES.map((choice) => (
                    <label
                      key={choice.label}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-soft-foreground"
                    >
                      <input
                        ref={index === 0 && choice.value ? firstChoiceRef : undefined}
                        id={`${textId}-${choice.value}`}
                        type="radio"
                        name={textId}
                        checked={answers[statement.id] === choice.value}
                        onChange={() =>
                          setAnswers((prev) => ({ ...prev, [statement.id]: choice.value }))
                        }
                        disabled={isLocked}
                      />
                      {choice.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Разбор: оценено верно или нет; при ошибке — правильная оценка и объяснение */}
              {statementReview && mark && (
                <div className="mt-2 text-sm">
                  <p className={`inline-flex items-center gap-1 font-medium ${mark.text}`}>
                    <mark.Icon size={16} aria-hidden="true" />
                    {statementReview.isCorrect
                      ? "Оценено верно"
                      : `Ошибка: на самом деле ${statementReview.isTrue ? "верно" : "неверно"}`}
                  </p>
                  {statementReview.explanation && (
                    <p className="mt-1 text-muted">{statementReview.explanation}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </ExerciseShell>
  );
}
