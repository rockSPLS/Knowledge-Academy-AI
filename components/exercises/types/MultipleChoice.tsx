"use client";

import { useId, useRef, useState } from "react";
import { Check, CircleAlert, ListChecks, X, type LucideIcon } from "lucide-react";
import type {
  ChoiceOptionStatus,
  MultipleChoiceAnswer,
  MultipleChoiceReview,
  PublicMultipleChoice,
} from "@/lib/exercises/types";
import { ExerciseShell } from "../ExerciseShell";
import { useExercise } from "../useExercise";

// Упражнение «Выбор ответа»: один или несколько правильных вариантов.
// Если верных несколько, отметить можно не больше их числа — но само число
// заранее не показывается. Подсказка появляется, только если упереться в лимит.

// Метки разбора: значок + слово, а не только цвет. Цвета — из токенов итогов
// (зелёный — верно, красный — лишний, янтарный — пропущен).
const STATUS_MARKS: Partial<
  Record<ChoiceOptionStatus, { Icon: LucideIcon; label: string; box: string; text: string }>
> = {
  correct: {
    Icon: Check,
    label: "Верно",
    box: "border-success-border bg-success-soft",
    text: "text-success",
  },
  wrong: {
    Icon: X,
    label: "Лишний",
    box: "border-danger-border bg-danger-soft",
    text: "text-danger",
  },
  missed: {
    Icon: CircleAlert,
    label: "Пропущен",
    box: "border-warning-border bg-warning-soft",
    text: "text-warning",
  },
};

export function MultipleChoice({ exercise }: { exercise: PublicMultipleChoice }) {
  const { status, result, revealError, submit, revealAnswer, reset, mode } =
    useExercise<MultipleChoiceAnswer>(exercise.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [isLimitHintVisible, setLimitHintVisible] = useState(false);
  // Уникальное имя группы, даже если одно упражнение встречается на странице дважды
  const groupName = useId();
  const firstOptionRef = useRef<HTMLInputElement>(null);
  const isLocked = status !== "idle" && status !== "error";
  const isMultiple = exercise.maxSelections > 1;
  // Разбор по вариантам — есть, только если сервер раскрыл ответ
  const details = result?.review?.details;
  const review: MultipleChoiceReview | null =
    details?.type === "multiple-choice" ? details : null;

  function toggle(optionId: string) {
    if (!isMultiple) {
      setSelected([optionId]);
      return;
    }
    if (selected.includes(optionId)) {
      setSelected(selected.filter((id) => id !== optionId));
      setLimitHintVisible(false);
    } else if (selected.length >= exercise.maxSelections) {
      // Сначала очищаем подсказку, затем показываем снова: экранный диктор озвучивает
      // только изменение текста, а так подсказка прозвучит при каждой попытке
      setLimitHintVisible(false);
      requestAnimationFrame(() => setLimitHintVisible(true));
    } else {
      setSelected([...selected, optionId]);
    }
  }

  function retry() {
    setSelected([]);
    setLimitHintVisible(false);
    reset();
    // Возвращаем фокус к вариантам ответа (после отрисовки, когда они снова доступны)
    requestAnimationFrame(() => firstOptionRef.current?.focus());
  }

  return (
    <ExerciseShell
      typeName="Выбор ответа"
      typeIcon={ListChecks}
      question={exercise.question}
      instruction={isMultiple ? "Выберите все подходящие варианты" : "Выберите один ответ"}
      status={status}
      result={result}
      revealError={revealError}
      mode={mode}
      canSubmit={selected.length > 0}
      onSubmit={() => submit({ selected })}
      onRetry={retry}
      onReveal={revealAnswer}
    >
      <div className="space-y-2">
        {exercise.options.map((option, index) => {
          const optionReview = review?.options[option.id];
          const mark = optionReview ? STATUS_MARKS[optionReview.status] : undefined;
          // Пояснение показываем у лишних и пропущенных — там, где была ошибка
          const showFeedback =
            optionReview?.feedback &&
            (optionReview.status === "wrong" || optionReview.status === "missed");

          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                mark
                  ? mark.box
                  : "border-border bg-background hover:border-border-strong has-[:checked]:border-accent"
              }`}
            >
              <input
                ref={index === 0 ? firstOptionRef : undefined}
                type={isMultiple ? "checkbox" : "radio"}
                name={groupName}
                checked={selected.includes(option.id)}
                onChange={() => toggle(option.id)}
                disabled={isLocked}
                className="mt-1"
              />
              <span className="flex-1 text-foreground">
                {option.text}
                {showFeedback && (
                  <span className="mt-1 block text-sm text-muted">
                    {optionReview.feedback}
                  </span>
                )}
              </span>
              {mark && (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 text-sm font-medium ${mark.text}`}
                >
                  <mark.Icon size={16} aria-hidden="true" />
                  {mark.label}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {/* Область всегда в разметке, чтобы экранный диктор озвучил появившийся текст */}
      <p aria-live="polite" className="mt-2 text-sm text-muted">
        {isLimitHintVisible && !isLocked
          ? `Можно выбрать не больше ${exercise.maxSelections} вариантов`
          : ""}
      </p>
    </ExerciseShell>
  );
}
