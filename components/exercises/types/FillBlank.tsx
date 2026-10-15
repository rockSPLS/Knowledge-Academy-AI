"use client";

import { Fragment, useId, useRef, useState } from "react";
import { PencilLine } from "lucide-react";
import type { FillBlankAnswer, FillBlankReview, PublicFillBlank } from "@/lib/exercises/types";
import { ExerciseShell } from "../ExerciseShell";
import { REVIEW_MARKS } from "../reviewMarks";
import { useExercise } from "../useExercise";

// Упражнение «Заполните пропуски»: поля ввода прямо внутри текста.
// Значения полей хранит React (управляемые поля ввода). Проверить можно,
// когда заполнены все пропуски.

export function FillBlank({ exercise }: { exercise: PublicFillBlank }) {
  const blankIds = exercise.parts.flatMap((part) => (part.type === "blank" ? [part.id] : []));
  const [values, setValues] = useState<Record<string, string>>({});
  const firstInputRef = useRef<HTMLInputElement>(null);
  // Префикс id для связи поля с его отметкой разбора (aria-describedby)
  const idPrefix = useId();
  // Пользователь пытался проверить, заполнив не все пропуски — подсвечиваем пустые
  const [showMissing, setShowMissing] = useState(false);
  const isComplete = blankIds.every((id) => (values[id] ?? "").trim() !== "");
  // Черновик для теста: ответ готов, когда заполнены все пропуски
  const { status, result, revealError, submit, revealAnswer, reset, mode } =
    useExercise<FillBlankAnswer>(exercise.id, {
      answer: isComplete ? { blanks: values } : null,
      touched: blankIds.some((id) => (values[id] ?? "").trim() !== ""),
    });
  const isLocked = status !== "idle" && status !== "error";

  function handleSubmit() {
    if (!isComplete) {
      setShowMissing(true);
      // Фокус — в первое пустое поле
      const firstEmpty = blankIds.find((id) => (values[id] ?? "").trim() === "");
      if (firstEmpty) document.getElementById(`${idPrefix}-${firstEmpty}-input`)?.focus();
      return;
    }
    submit({ blanks: values });
  }

  // Enter в поле — то же, что кнопка «Проверить», как в обычной форме
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // В тесте своей отправки нет — ответы отправляет «Завершить тест»
    if (event.key === "Enter" && mode === "inline" && !isLocked) handleSubmit();
  }

  const details = result?.review?.details;
  const review: FillBlankReview | null = details?.type === "fill-blank" ? details : null;

  function retry() {
    setShowMissing(false);
    setValues({});
    reset();
    requestAnimationFrame(() => firstInputRef.current?.focus());
  }

  // Пояснения к неверно заполненным пропускам — списком под текстом
  const feedbackItems = review
    ? blankIds.flatMap((id, index) => {
        const blank = review.blanks[id];
        return blank && !blank.isCorrect && blank.feedback
          ? [{ id, number: index + 1, feedback: blank.feedback }]
          : [];
      })
    : [];

  return (
    <ExerciseShell
      exerciseId={exercise.id}
      typeName="Заполните пропуски"
      typeIcon={PencilLine}
      question={exercise.question}
      instruction={blankIds.length > 1 ? "Впишите пропущенные слова" : "Впишите пропущенное слово"}
      status={status}
      result={result}
      revealError={revealError}
      mode={mode}
      validationMessage={showMissing && !isComplete ? "Заполните все пропуски" : null}
      onSubmit={handleSubmit}
      onRetry={retry}
      onReveal={revealAnswer}
    >
      <p className="leading-10">
        {exercise.parts.map((part, partIndex) => {
          // Префиксы ключей: индекс текста и id пропуска не должны совпасть
          if (part.type === "text") return <Fragment key={`t${partIndex}`}>{part.value}</Fragment>;

          const number = blankIds.indexOf(part.id) + 1;
          const blankReview = review?.blanks[part.id];
          const mark = blankReview
            ? REVIEW_MARKS[blankReview.isCorrect ? "correct" : "wrong"]
            : undefined;
          const markId = `${idPrefix}-${part.id}-mark`;
          const isMissing = showMissing && (values[part.id] ?? "").trim() === "";

          return (
            <span key={`b-${part.id}`} className="inline-flex flex-wrap items-baseline gap-1 align-baseline">
              <input
                ref={number === 1 ? firstInputRef : undefined}
                id={`${idPrefix}-${part.id}-input`}
                type="text"
                aria-label={`Пропуск ${number}`}
                aria-describedby={blankReview ? markId : undefined}
                aria-invalid={blankReview ? !blankReview.isCorrect : isMissing || undefined}
                value={values[part.id] ?? ""}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [part.id]: event.target.value }))
                }
                onKeyDown={handleKeyDown}
                readOnly={isLocked}
                maxLength={60}
                autoComplete="off"
                spellCheck={false}
                className={`w-36 rounded-md border px-2 py-1 leading-normal focus:border-accent ${
                  mark
                    ? mark.box
                    : isMissing
                      ? "border-accent bg-background ring-1 ring-accent"
                      : "border-border-strong bg-background"
                }`}
              />
              {/* Разбор: значок и слово рядом с полем; при ошибке — правильный ответ.
                  Поле ссылается на эту отметку, поэтому диктор прочитает её вместе с полем. */}
              {blankReview && mark && (
                <span
                  id={markId}
                  className={`inline-flex items-center gap-1 text-sm font-medium ${mark.text}`}
                >
                  <mark.Icon size={16} aria-hidden="true" />
                  {blankReview.isCorrect ? "Верно" : `Ответ: ${blankReview.expected}`}
                </span>
              )}
            </span>
          );
        })}
      </p>

      {feedbackItems.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-muted">
          {feedbackItems.map((item) => (
            <li key={item.id}>
              Пропуск {item.number}: {item.feedback}
            </li>
          ))}
        </ul>
      )}
    </ExerciseShell>
  );
}
