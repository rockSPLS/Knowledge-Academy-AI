"use client";

import { useId, useRef, useState } from "react";
import type { MultipleChoiceAnswer, PublicMultipleChoice } from "@/lib/exercises/types";
import { ExerciseShell } from "../ExerciseShell";
import { useExercise } from "../useExercise";

// Упражнение «Выбор ответа»: один или несколько правильных вариантов.
// Если верных несколько, отметить можно не больше их числа — но само число
// заранее не показывается. Подсказка появляется, только если упереться в лимит.

export function MultipleChoice({ exercise }: { exercise: PublicMultipleChoice }) {
  const { status, result, submit, reset, mode } = useExercise<MultipleChoiceAnswer>(exercise.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [isLimitHintVisible, setLimitHintVisible] = useState(false);
  // Уникальное имя группы, даже если одно упражнение встречается на странице дважды
  const groupName = useId();
  const firstOptionRef = useRef<HTMLInputElement>(null);
  const isLocked = status === "checking" || status === "checked";
  const isMultiple = exercise.maxSelections > 1;

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
      typeLabel={isMultiple ? "Выберите все подходящие варианты" : "Выберите один ответ"}
      question={exercise.question}
      status={status}
      result={result}
      mode={mode}
      canSubmit={selected.length > 0}
      onSubmit={() => submit({ selected })}
      onRetry={retry}
    >
      <div className="space-y-2">
        {exercise.options.map((option, index) => (
          <label
            key={option.id}
            className="flex cursor-pointer items-start gap-3 rounded-md border border-foreground/10 p-3 has-[:checked]:border-foreground/40"
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
            <span>{option.text}</span>
          </label>
        ))}
      </div>
      {/* Область всегда в разметке, чтобы экранный диктор озвучил появившийся текст */}
      <p aria-live="polite" className="mt-2 text-sm text-foreground/70">
        {isLimitHintVisible && !isLocked
          ? `Можно выбрать не больше ${exercise.maxSelections} вариантов`
          : ""}
      </p>
    </ExerciseShell>
  );
}
