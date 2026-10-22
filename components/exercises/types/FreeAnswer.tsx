"use client";

import { useId, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { MAX_FREE_ANSWER_LENGTH } from "@/lib/exercises/limits";
import { normalizeText } from "@/lib/exercises/text";
import type {
  FreeAnswerAnswer,
  FreeAnswerFeedback,
  FreeAnswerReview,
  PublicFreeAnswer,
} from "@/lib/exercises/types";
import { useJourneyExercise } from "@/components/journey/JourneyExerciseContext";
import { ExerciseShell } from "../ExerciseShell";
import { REVIEW_MARKS } from "../reviewMarks";
import { useExercise } from "../useExercise";

// Свободный ответ — общая начинка для четырёх видов задания (развёрнутый ответ,
// простыми словами, объясните другу, свой пример: файлы рядом). Виды отличаются
// названием, значком, инструкцией и подсказкой в поле; логика одна.
// Ответ оценивает модель по 2–3 критериям: после каждой попытки — отзыв по каждому
// критерию (что получилось, чего не хватает), после раскрытия — сами критерии и образец.

export type FreeAnswerProps = {
  exercise: PublicFreeAnswer;
  typeName: string;
  typeIcon: LucideIcon;
  instruction: string;
  placeholder: string;
};

export function FreeAnswer({ exercise, typeName, typeIcon, instruction, placeholder }: FreeAnswerProps) {
  const [text, setText] = useState("");
  const [isEmptyShown, setEmptyShown] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const noteId = useId();
  const journey = useJourneyExercise();
  // Черновик для теста: ответ готов, если в нём есть хоть что-то кроме пробелов и знаков
  const isFilled = normalizeText(text) !== "";
  const {
    status,
    result,
    revealError,
    errorMessage,
    submit,
    revealAnswer,
    reset,
    skip,
    mode,
    locked,
  } = useExercise<FreeAnswerAnswer>(
    exercise.id,
    { answer: isFilled ? { text } : null, touched: isFilled },
    { unratedFallback: true },
  );

  const details = result?.review?.details;
  const review: FreeAnswerReview | null = details?.type === "free-answer" ? details : null;

  function handleSubmit() {
    if (!isFilled) {
      setEmptyShown(true);
      textareaRef.current?.focus();
      return;
    }
    setEmptyShown(false);
    submit({ text });
  }

  // Повтор сохраняет текст: ответ дорабатывают по отзыву, а не пишут заново
  function retry() {
    reset();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <ExerciseShell
      exerciseId={exercise.id}
      typeName={typeName}
      typeIcon={typeIcon}
      question={exercise.question}
      instruction={instruction}
      status={status}
      result={result}
      revealError={revealError}
      errorMessage={errorMessage}
      errorAction={
        // Модель недоступна — путешествие не должно на этом застрять
        journey && (
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => skip(true)}
              className="rounded-md border border-border-strong bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-border"
            >
              Пропустить без оценки
            </button>
            <p className="text-sm text-muted">
              {/* Если первая попытка уже была, засчитывается она (как и при конце времени) */}
              {journey.attemptsUsed(exercise.id) >= 1
                ? "Откроется образец ответа, засчитается первая попытка."
                : "Откроется образец ответа, упражнение не засчитается."}
            </p>
          </div>
        )
      }
      mode={mode}
      validationMessage={isEmptyShown && !isFilled ? "Напишите ответ" : null}
      onSubmit={handleSubmit}
      onRetry={retry}
      onReveal={revealAnswer}
    >
      <div className="space-y-3">
        <div>
          <label htmlFor={fieldId} className="block text-sm font-medium">
            Ваш ответ
          </label>
          <textarea
            ref={textareaRef}
            id={fieldId}
            value={text}
            onChange={(event) => setText(event.target.value)}
            readOnly={locked}
            rows={5}
            placeholder={placeholder}
            maxLength={MAX_FREE_ANSWER_LENGTH}
            spellCheck
            aria-describedby={noteId}
            aria-invalid={isEmptyShown && !isFilled ? true : undefined}
            className={`mt-1 w-full resize-y rounded-md border bg-background px-3 py-2 leading-normal focus:border-accent ${
              isEmptyShown && !isFilled ? "border-accent ring-1 ring-accent" : "border-border-strong"
            }`}
          />
          {/* Честно о способе проверки: оценивает ИИ, и он может ошибиться */}
          <div id={noteId} className="mt-1 flex flex-wrap justify-between gap-x-4 text-sm text-muted">
            <span>Оценивает ИИ — по смыслу, а не по словам. Он может ошибаться.</span>
            <span aria-hidden="true">
              {text.length} / {MAX_FREE_ANSWER_LENGTH}
            </span>
          </div>
        </div>

        {/* Область для дикторов есть всегда, меняется только текст — так его озвучат */}
        <p role="status" className="text-sm text-muted empty:hidden">
          {status === "checking" ? "ИИ оценивает ответ — обычно это несколько секунд." : ""}
        </p>

        {review ? (
          <div className="space-y-3">
            <CriteriaList
              items={review.criteria.map((criterion) => ({ ...criterion, label: criterion.text }))}
            />
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-subtle">Образец ответа</p>
              <p className="mt-1">{review.sample}</p>
            </div>
          </div>
        ) : (
          // До раскрытия — только отзыв: сами критерии подсказали бы, что дописать
          result?.feedback && <CriteriaList items={result.feedback} />
        )}
      </div>
    </ExerciseShell>
  );
}

// Отзыв по критериям: «Есть» / «Не хватает» — значок и слово, а не только цвет
function CriteriaList({ items }: { items: (FreeAnswerFeedback & { label?: string })[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => {
        const mark = REVIEW_MARKS[item.met ? "correct" : "missed"];
        return (
          <li key={index} className={`rounded-lg border p-3 ${mark.box}`}>
            <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${mark.text}`}>
              <mark.Icon size={16} aria-hidden="true" />
              {item.met ? "Есть" : "Не хватает"}
            </span>{" "}
            {/* Пробел выше — чтобы диктор не прочитал «ЕстьКислород» слитно */}
            {item.label && <span className="ml-1 font-medium">{item.label}</span>}
            <span className="mt-1 block text-sm">{item.feedback}</span>
          </li>
        );
      })}
    </ul>
  );
}
