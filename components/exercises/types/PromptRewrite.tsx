"use client";

import { useId, useRef, useState } from "react";
import { FilePenLine } from "lucide-react";
import { MAX_PROMPT_LENGTH } from "@/lib/exercises/limits";
import { normalizeText } from "@/lib/exercises/text";
import type {
  PromptRewriteAnswer,
  PromptRewriteReview,
  PublicPromptRewrite,
} from "@/lib/exercises/types";
import { ExerciseShell } from "../ExerciseShell";
import { REVIEW_MARKS } from "../reviewMarks";
import { useExercise } from "../useExercise";

// Упражнение «Улучшите промпт»: дан слабый промпт и неудачный ответ модели —
// пользователь переписывает промпт. Сервер ищет в тексте признаки сильного промпта;
// после раскрытия — чек-лист признаков и образец.

export function PromptRewrite({ exercise }: { exercise: PublicPromptRewrite }) {
  // Поле пустое: исходный промпт и так показан над ним, в поле он только дублировался бы.
  // Скопировать исходный и дописать — тоже изменение; без дописок — «Измените промпт»
  const [text, setText] = useState("");
  // Почему нельзя проверить: пустой текст или промпт не изменён
  const [problem, setProblem] = useState<"empty" | "unchanged" | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const noteId = useId();
  // Черновик для теста: ответ готов, если промпт не пустой и отличается от исходного
  // (та же нормализация, что на сервере)
  const isRewritten =
    normalizeText(text) !== "" && normalizeText(text) !== normalizeText(exercise.weakPrompt);
  const { status, result, revealError, submit, revealAnswer, reset, mode, locked } =
    useExercise<PromptRewriteAnswer>(exercise.id, {
      answer: isRewritten ? { text } : null,
      touched: isRewritten,
    });
  const isLocked = locked;

  const details = result?.review?.details;
  const review: PromptRewriteReview | null = details?.type === "prompt-rewrite" ? details : null;

  function currentProblem(value: string): "empty" | "unchanged" | null {
    // Та же нормализация, что на сервере: текст из одних знаков препинания — пустой,
    // а исходный промпт без точки или в другом регистре — не изменён
    const normalized = normalizeText(value);
    if (normalized === "") return "empty";
    if (normalized === normalizeText(exercise.weakPrompt)) return "unchanged";
    return null;
  }

  function handleSubmit() {
    const found = currentProblem(text);
    if (found) {
      setProblem(found);
      textareaRef.current?.focus();
      return;
    }
    setProblem(null);
    submit({ text });
  }

  // Повтор сохраняет текст: смысл упражнения — дорабатывать свой промпт, а не писать заново
  function retry() {
    setProblem(null);
    reset();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  // Сообщение показываем, пока проблема не исправлена
  const activeProblem = problem && currentProblem(text) === problem ? problem : null;

  return (
    <ExerciseShell
      exerciseId={exercise.id}
      typeName="Улучшите промпт"
      typeIcon={FilePenLine}
      question={exercise.question}
      instruction="Перепишите промпт так, чтобы модель могла дать полезный ответ"
      status={status}
      result={result}
      revealError={revealError}
      mode={mode}
      validationMessage={
        activeProblem === "empty"
          ? "Напишите промпт"
          : activeProblem === "unchanged"
            ? "Измените промпт — сейчас он такой же, как исходный"
            : null
      }
      onSubmit={handleSubmit}
      onRetry={retry}
      onReveal={revealAnswer}
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">Исходный промпт</p>
          <p className="mt-1">{exercise.weakPrompt}</p>
        </div>
        <div className="rounded-lg border border-border bg-background p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-subtle">Ответ модели</p>
          <p className="mt-1 text-muted">{exercise.weakAnswer}</p>
        </div>

        <div>
          <label htmlFor={fieldId} className="block text-sm font-medium">
            Ваш промпт
          </label>
          <textarea
            ref={textareaRef}
            id={fieldId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            readOnly={isLocked}
            rows={5}
            placeholder="Напишите улучшенный промпт"
            maxLength={MAX_PROMPT_LENGTH}
            spellCheck
            aria-describedby={noteId}
            aria-invalid={activeProblem ? true : undefined}
            className={`mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 leading-normal focus:border-accent ${
              activeProblem ? "border-accent ring-1 ring-accent" : "border-border-strong"
            }`}
          />
          {/* Честно о способе проверки: ответа модели не будет (чтобы не ждали рецепт),
              а признаки ищутся в тексте, без понимания смысла */}
          <p id={noteId} className="mt-1 text-sm text-muted">
            Проверяется сам промпт — ответа модели на него не будет. Проверка — по признакам
            в тексте, без ИИ: необычную формулировку она может не узнать.
          </p>
        </div>

        {review && (
          <div className="space-y-3">
            <ul className="space-y-2">
              {review.criteria.map((criterion) => {
                const mark = REVIEW_MARKS[criterion.found ? "correct" : "missed"];
                return (
                  <li key={criterion.id} className={`rounded-lg border p-3 ${mark.box}`}>
                    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${mark.text}`}>
                      <mark.Icon size={16} aria-hidden="true" />
                      {criterion.found ? "Есть" : "Не нашли"}
                    </span>{" "}
                    {/* Пробел выше — чтобы диктор не прочитал «ЕстьКонтекст» слитно */}
                    <span className="ml-1 font-medium">{criterion.label}</span>
                    {criterion.howTo && (
                      <span className="mt-1 block text-sm text-muted">{criterion.howTo}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">
                Пример сильного промпта
              </p>
              <p className="mt-1">{review.sample}</p>
            </div>
          </div>
        )}
      </div>
    </ExerciseShell>
  );
}
