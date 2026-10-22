"use client";

import { useId, useState } from "react";
import { Gauge, TriangleAlert } from "lucide-react";
import { MAX_CALIBRATION_ANSWER_LENGTH } from "@/lib/exercises/limits";
import { normalizeText } from "@/lib/exercises/text";
import type { CalibrationAnswer, CalibrationReview, PublicCalibration } from "@/lib/exercises/types";
import { plural } from "@/lib/plural";
import { ExerciseShell } from "../ExerciseShell";
import { REVIEW_MARKS, type ReviewMark } from "../reviewMarks";
import { UnratedSkipAction } from "../UnratedSkipAction";
import { useExercise } from "../useExercise";

// Собственный тип путешествий «Калибровка уверенности»: на каждый короткий вопрос человек
// отвечает своими словами и отмечает «Точно знаю» или «Сомневаюсь». Ответы оценивает ИИ,
// очки за уверенность считает сервер (lib/exercises/handlers/calibration.ts). Попытка одна,
// разбор сразу; в конце — вывод «когда вы были уверены, вы были правы в N из M».

const CONFIDENCE = [
  { value: true, label: "Точно знаю" },
  { value: false, label: "Сомневаюсь" },
] as const;

// Уверенная ошибка — своя отметка: это главное, что показывает упражнение
const CONFIDENT_WRONG_MARK: ReviewMark = { ...REVIEW_MARKS.wrong, Icon: TriangleAlert };

// Отметка и подпись по сочетанию «уверенность — верно ли»
function itemMark(confident: boolean, correct: boolean): { mark: ReviewMark; label: string } {
  if (correct) {
    return {
      mark: REVIEW_MARKS.correct,
      label: confident ? "Верно, и вы были уверены" : "Верно — вы знали больше, чем думали",
    };
  }
  return confident
    ? { mark: CONFIDENT_WRONG_MARK, label: "Уверенная ошибка" }
    : { mark: REVIEW_MARKS.wrong, label: "Неверно — и вы сомневались не зря" };
}

type Draft = { text: string; confident: boolean | null };

export function Calibration({ exercise }: { exercise: PublicCalibration }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [showMissing, setShowMissing] = useState(false);
  // Уникальный префикс id полей, даже если упражнение встречается на странице дважды
  const prefix = useId();

  const isItemComplete = (id: string) => {
    const draft = drafts[id];
    return draft !== undefined && normalizeText(draft.text) !== "" && draft.confident !== null;
  };
  const isComplete = exercise.items.every((item) => isItemComplete(item.id));
  const answer: CalibrationAnswer | null = isComplete
    ? {
        answers: Object.fromEntries(
          exercise.items.map((item) => [
            item.id,
            { text: drafts[item.id].text, confident: drafts[item.id].confident === true },
          ]),
        ),
      }
    : null;

  const { status, result, revealError, errorMessage, submit, revealAnswer, reset, skip, mode, locked } =
    useExercise<CalibrationAnswer>(
      exercise.id,
      { answer, touched: Object.keys(drafts).length > 0 },
      { unratedFallback: true },
    );

  const details = result?.review?.details;
  const review: CalibrationReview | null = details?.type === "calibration" ? details : null;

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { text: "", confident: null }), ...patch } }));
  }

  function handleSubmit() {
    if (!answer) {
      setShowMissing(true);
      // Фокус — на первый незаполненный вопрос: на поле, если ответа нет, иначе на уверенность
      const missing = exercise.items.find((item) => !isItemComplete(item.id));
      if (missing) {
        const hasText = normalizeText(drafts[missing.id]?.text ?? "") !== "";
        document.getElementById(`${prefix}-${missing.id}-${hasText ? "sure" : "text"}`)?.focus();
      }
      return;
    }
    setShowMissing(false);
    submit(answer);
  }

  return (
    <ExerciseShell
      exerciseId={exercise.id}
      typeName="Калибровка уверенности"
      typeIcon={Gauge}
      question={exercise.question}
      instruction="Если не знаете — напишите догадку и отметьте «Сомневаюсь». Попытка одна."
      status={status}
      result={result}
      revealError={revealError}
      errorMessage={errorMessage}
      errorAction={
        <UnratedSkipAction exerciseId={exercise.id} onSkip={() => skip(true)} opens="Откроются правильные ответы" />
      }
      mode={mode}
      validationMessage={
        showMissing && !isComplete ? "Ответьте на все вопросы и отметьте уверенность" : null
      }
      onSubmit={handleSubmit}
      // Попытка одна и разбор приходит сразу — кнопки повтора оболочка не показывает
      onRetry={reset}
      onReveal={revealAnswer}
    >
      <div className="space-y-3">
        <ol className="space-y-2">
          {exercise.items.map((item, index) => {
            const draft = drafts[item.id];
            const itemReview = review?.items[item.id];
            const verdict = itemReview ? itemMark(itemReview.confident, itemReview.correct) : null;
            const isMissing = showMissing && !isItemComplete(item.id);
            const inputId = `${prefix}-${item.id}-text`;

            return (
              <li
                key={item.id}
                className={`rounded-lg border p-3 transition-colors ${
                  verdict
                    ? verdict.mark.box
                    : isMissing
                      ? "border-accent bg-background ring-1 ring-accent"
                      : "border-border bg-background"
                }`}
              >
                <label htmlFor={inputId} className="block">
                  {index + 1}. {item.question}
                </label>
                <input
                  id={inputId}
                  type="text"
                  value={draft?.text ?? ""}
                  onChange={(event) => update(item.id, { text: event.target.value })}
                  readOnly={locked}
                  maxLength={MAX_CALIBRATION_ANSWER_LENGTH}
                  placeholder="Ваш ответ"
                  autoComplete="off"
                  aria-invalid={isMissing && normalizeText(draft?.text ?? "") === "" ? true : undefined}
                  className="mt-2 w-full rounded-md border border-border-strong bg-background px-3 py-1.5 focus:border-accent"
                />
                <div
                  role="radiogroup"
                  aria-label={`Насколько вы уверены в ответе на вопрос ${index + 1}`}
                  aria-invalid={isMissing && draft?.confident == null ? true : undefined}
                  className="mt-2 flex flex-wrap gap-2"
                >
                  {CONFIDENCE.map((choice) => (
                    <label
                      key={choice.label}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-soft-foreground"
                    >
                      <input
                        id={choice.value ? `${prefix}-${item.id}-sure` : undefined}
                        type="radio"
                        name={`${prefix}-${item.id}-confidence`}
                        checked={draft?.confident === choice.value}
                        onChange={() => update(item.id, { confident: choice.value })}
                        disabled={locked}
                      />
                      {choice.label}
                    </label>
                  ))}
                </div>

                {/* Разбор: сочетание уверенности и верности, отзыв ИИ; у неверных — правильный ответ */}
                {itemReview && verdict && (
                  <div className="mt-2 text-sm">
                    <p className={`inline-flex items-center gap-1 font-medium ${verdict.mark.text}`}>
                      <verdict.mark.Icon size={16} aria-hidden="true" />
                      {verdict.label}
                    </p>
                    <p className="mt-1">{itemReview.feedback}</p>
                    {!itemReview.correct && (
                      <p className="mt-1 text-muted">Правильный ответ: {itemReview.expected}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {/* Область для дикторов есть всегда, меняется только текст — так его озвучат */}
        <p role="status" className="text-sm text-muted empty:hidden">
          {status === "checking" ? "ИИ оценивает ответы — обычно это несколько секунд." : ""}
        </p>

        {review ? (
          <CalibrationSummary items={Object.values(review.items)} />
        ) : (
          <p className="text-sm text-muted">Оценивает ИИ — по смыслу, а не по словам. Он может ошибаться.</p>
        )}
      </div>
    </ExerciseShell>
  );
}

// Вывод упражнения: насколько уверенность совпала с тем, что вы знаете на самом деле
function CalibrationSummary({ items }: { items: { confident: boolean; correct: boolean }[] }) {
  const confident = items.filter((item) => item.confident);
  const confidentCorrect = confident.filter((item) => item.correct).length;
  const unsure = items.filter((item) => !item.confident);
  const unsureCorrect = unsure.filter((item) => item.correct).length;
  const confidentWrong = confident.length - confidentCorrect;

  let conclusion: string;
  if (confidentWrong > 0) {
    conclusion = "Уверенные ошибки стоит перепроверить: здесь кажется, что знаешь, а это не так.";
  } else if (confident.length > 0) {
    conclusion =
      unsureCorrect > 0
        ? "Уверенность вас не подвела, а часть сомнений была напрасной."
        : "Уверенность вас не подвела ни разу.";
  } else {
    conclusion = "Отмечайте «Точно знаю», когда помните ответ, — так виднее, что вы знаете на самом деле.";
  }

  return (
    <div className="rounded-lg bg-background p-3">
      <p className="font-medium">
        {confident.length > 0
          ? `Когда вы были уверены, вы были правы в ${confidentCorrect} из ${confident.length} ${plural(confident.length, ["случая", "случаев", "случаев"])} (${Math.round((confidentCorrect / confident.length) * 100)} %)`
          : "Вы ни в одном ответе не были уверены"}
      </p>
      <p className="mt-1 text-sm text-muted">
        {unsure.length > 0 && `Сомневались: ${unsure.length}, из них верно ${unsureCorrect}. `}
        {conclusion}
      </p>
    </div>
  );
}
