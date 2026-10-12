"use client";

import { useId, useRef, useState } from "react";
import type { MultipleChoiceAnswer, PublicMultipleChoice } from "@/lib/exercises/types";
import { ExerciseShell } from "../ExerciseShell";
import { useExercise } from "../useExercise";

// Упражнение «Выбор ответа»: один или несколько правильных вариантов.

export function MultipleChoice({ exercise }: { exercise: PublicMultipleChoice }) {
  const { status, result, submit, reset, mode } = useExercise<MultipleChoiceAnswer>(exercise.id);
  const [selected, setSelected] = useState<string[]>([]);
  // Уникальное имя группы, даже если одно упражнение встречается на странице дважды
  const groupName = useId();
  const firstOptionRef = useRef<HTMLInputElement>(null);
  const isLocked = status === "checking" || status === "checked";

  function toggle(optionId: string) {
    if (exercise.multiple) {
      setSelected((prev) =>
        prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
      );
    } else {
      setSelected([optionId]);
    }
  }

  function retry() {
    setSelected([]);
    reset();
    // Возвращаем фокус к вариантам ответа (после отрисовки, когда они снова доступны)
    requestAnimationFrame(() => firstOptionRef.current?.focus());
  }

  return (
    <ExerciseShell
      typeLabel={exercise.multiple ? "Выбор нескольких ответов" : "Выбор ответа"}
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
              type={exercise.multiple ? "checkbox" : "radio"}
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
    </ExerciseShell>
  );
}
