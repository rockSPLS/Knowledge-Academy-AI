"use client";

import {
  Clock,
  Coins,
  Feather,
  FilePenLine,
  Gauge,
  Link2,
  ListChecks,
  ListOrdered,
  MessagesSquare,
  PencilLine,
  Puzzle,
  ToggleRight,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { VERDICTS } from "@/components/exercises/ExerciseShell";
import { REVIEW_MARKS } from "@/components/exercises/reviewMarks";
import { CalibrationSummary, itemMark } from "@/components/exercises/types/Calibration";
import type {
  CalibrationAnswer,
  ExerciseReviewDetails,
  FillBlankAnswer,
  MatchPairsAnswer,
  MultipleChoiceAnswer,
  OrderStepsAnswer,
  PublicExercise,
  TrueFalseAnswer,
} from "@/lib/exercises/types";
import { skippedLabel } from "./outcomeLabels";
import type { ExerciseOutcome } from "./state";

// Компактная запись упражнения с итогом: вопрос, итог, ответ человека, разбор и объяснение.
// Только для чтения — одна и та же запись в чекпоинте после перезагрузки страницы
// и в итогах путешествия (в том числе на печати). Ответ и разбор берутся из прогресса
// (state.ts); в прогрессе, сохранённом до появления ответов, их нет — тогда только итог
// и объяснение, как раньше.

// Название и значок типа — те же, что в карточках упражнений (components/exercises/types/)
function typeLabel(exercise: PublicExercise): { name: string; Icon: LucideIcon } | undefined {
  switch (exercise.type) {
    case "multiple-choice":
      return { name: "Выбор ответа", Icon: ListChecks };
    case "true-false":
      return { name: "Верно или неверно", Icon: ToggleRight };
    case "fill-blank":
      return { name: "Заполните пропуски", Icon: PencilLine };
    case "match-pairs":
      return { name: "Соедините пары", Icon: Link2 };
    case "order-steps":
      return { name: "Расставьте шаги", Icon: ListOrdered };
    case "costed-select":
      return { name: "Цена выбора", Icon: Coins };
    case "prompt-rewrite":
      return { name: "Улучшите промпт", Icon: FilePenLine };
    case "calibration":
      return { name: "Калибровка уверенности", Icon: Gauge };
    case "free-answer":
      switch (exercise.kind) {
        case "explain":
          return { name: "Развёрнутый ответ", Icon: PencilLine };
        case "simple":
          return { name: "Объясните простыми словами", Icon: Feather };
        case "friend":
          return { name: "Объясните другу", Icon: MessagesSquare };
        case "example":
          return { name: "Приведите свой пример", Icon: Puzzle };
      }
  }
}

type AnswerRecordProps = {
  exercise: PublicExercise;
  outcome: ExerciseOutcome;
  // Открывали ли подсказку
  hint: boolean;
  // Номер упражнения в чекпоинте — в итогах путешествия
  number?: number;
  id?: string;
  className?: string;
};

export function AnswerRecord({ exercise, outcome, hint, number, id, className = "" }: AnswerRecordProps) {
  const verdict = VERDICTS[outcome.verdict];
  // Неизвестный вид — только в испорченных данных: тогда без строки типа
  const { name, Icon } = typeLabel(exercise) ?? { name: "Упражнение", Icon: ListChecks };
  // Разбор подходит, только если он того же типа, что упражнение
  const details = outcome.details?.type === exercise.type ? outcome.details : undefined;
  const notes = [
    outcome.attempts > 1 && "со второй попытки",
    hint && "с подсказкой",
  ].filter(Boolean);

  return (
    <section
      id={id}
      className={`scroll-mt-24 space-y-3 rounded-xl border border-border bg-surface p-5 text-sm break-inside-avoid ${className}`}
    >
      <div>
        <p className="flex items-center gap-1.5 text-muted">
          <Icon size={16} aria-hidden="true" />
          {number !== undefined && `Упражнение ${number} · `}
          {name}
        </p>
        <p className="mt-1 text-base font-semibold">{exercise.question}</p>
      </div>

      <div>
        <p className={`inline-flex flex-wrap items-center gap-x-1.5 font-semibold ${outcome.skipped ? "text-muted" : verdict.className}`}>
          {outcome.skipped ? (
            outcome.unrated ? <TriangleAlert size={18} aria-hidden="true" /> : <Clock size={18} aria-hidden="true" />
          ) : (
            <verdict.Icon size={18} aria-hidden="true" />
          )}
          {outcome.skipped ? skippedLabel(outcome) : verdict.label}
          {notes.length > 0 && <span className="font-normal text-muted">· {notes.join(", ")}</span>}
        </p>
        {outcome.unrated && !outcome.skipped && <p className="mt-1 text-muted">{skippedLabel(outcome)}</p>}
      </div>

      {outcome.answer !== undefined && (
        <AnswerBody exercise={exercise} answer={outcome.answer} details={details} />
      )}

      {/* В объяснении пропуска без оценки — образец или правильные ответы отдельным абзацем */}
      <p className="whitespace-pre-line text-muted">{outcome.explanation}</p>
    </section>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Ответ человека и разбор по элементам — по типу упражнения
function AnswerBody({
  exercise,
  answer,
  details,
}: {
  exercise: PublicExercise;
  answer: unknown;
  details: ExerciseReviewDetails | undefined;
}) {
  if (!isRecord(answer)) return null;

  switch (exercise.type) {
    case "multiple-choice": {
      const { selected } = answer as MultipleChoiceAnswer;
      if (!Array.isArray(selected)) return null;
      const statuses = details?.type === "multiple-choice" ? details.options : undefined;
      const isSingle = exercise.maxSelections === 1;
      // Отмечаются выбранные и пропущенные варианты; остальные — без отметки, как в карточке
      const shown = exercise.options.filter(
        (option) => selected.includes(option.id) || statuses?.[option.id]?.status === "missed",
      );
      return (
        <ul className="space-y-1.5">
          {shown.map((option) => {
            const status = statuses?.[option.id];
            const isSelected = selected.includes(option.id);
            const kind = !status
              ? null
              : status.status === "missed"
                ? "missed"
                : status.status === "correct"
                  ? "correct"
                  : "wrong";
            const label =
              kind === "missed"
                ? isSingle ? "Верный ответ:" : "Пропущен:"
                : kind === "correct"
                  ? "Ваш ответ — верно:"
                  : kind === "wrong"
                    ? isSingle ? "Ваш ответ — неверно:" : "Ваш ответ — лишний:"
                    : isSelected && "Ваш ответ:";
            return (
              <li key={option.id}>
                <Marked kind={kind} label={label}>
                  {option.text}
                </Marked>
                {status?.feedback && <p className="mt-0.5 pl-5 text-muted">{status.feedback}</p>}
              </li>
            );
          })}
        </ul>
      );
    }

    // Цена выбора в путешествиях не встречается (она есть только в статьях) — просто что взяли
    case "costed-select": {
      const { selected } = answer as { selected: unknown };
      if (!Array.isArray(selected)) return null;
      return (
        <ul className="list-disc space-y-1 pl-5">
          {exercise.options
            .filter((option) => selected.includes(option.id))
            .map((option) => (
              <li key={option.id}>{option.text}</li>
            ))}
        </ul>
      );
    }

    case "true-false": {
      const { answers } = answer as TrueFalseAnswer;
      if (!isRecord(answers)) return null;
      const review = details?.type === "true-false" ? details.statements : undefined;
      return (
        <ul className="space-y-2">
          {exercise.statements.map((statement) => {
            const value = answers[statement.id];
            const item = review?.[statement.id];
            return (
              <li key={statement.id}>
                <p>{statement.text}</p>
                <Marked
                  kind={item ? (item.isCorrect ? "correct" : "wrong") : null}
                  label={`Ваша оценка: ${value === true ? "верно" : value === false ? "неверно" : "—"}`}
                >
                  {item && !item.isCorrect && `· на самом деле ${item.isTrue ? "верно" : "неверно"}`}
                </Marked>
                {item?.explanation && <p className="mt-0.5 pl-5 text-muted">{item.explanation}</p>}
              </li>
            );
          })}
        </ul>
      );
    }

    case "fill-blank": {
      const { blanks } = answer as FillBlankAnswer;
      if (!isRecord(blanks)) return null;
      const review = details?.type === "fill-blank" ? details.blanks : undefined;
      return (
        <p className="leading-relaxed">
          {exercise.parts.map((part, index) => {
            if (part.type === "text") return <span key={index}>{part.value}</span>;
            const value = typeof blanks[part.id] === "string" ? blanks[part.id] : "";
            const item = review?.[part.id];
            const mark = item ? REVIEW_MARKS[item.isCorrect ? "correct" : "wrong"] : null;
            return (
              <span key={index} className={`font-medium ${mark?.text ?? ""}`}>
                [{value || "—"}
                {item && !item.isCorrect && <span className="font-normal"> → {item.expected}</span>}]
              </span>
            );
          })}
        </p>
      );
    }

    case "match-pairs": {
      const { matches } = answer as MatchPairsAnswer;
      if (!isRecord(matches)) return null;
      const review = details?.type === "match-pairs" ? details.terms : undefined;
      const definition = (id: unknown) => exercise.definitions.find((d) => d.id === id)?.text ?? "—";
      return (
        <ul className="space-y-2">
          {exercise.terms.map((term) => {
            const item = review?.[term.id];
            return (
              <li key={term.id}>
                <Marked kind={item ? (item.isCorrect ? "correct" : "wrong") : null} label={term.text}>
                  — {definition(matches[term.id])}
                </Marked>
                {item && !item.isCorrect && <p className="mt-0.5 pl-5">Правильно: {definition(item.expected)}</p>}
                {item?.feedback && <p className="mt-0.5 pl-5 text-muted">{item.feedback}</p>}
              </li>
            );
          })}
        </ul>
      );
    }

    case "order-steps": {
      const { order } = answer as OrderStepsAnswer;
      if (!Array.isArray(order)) return null;
      const review = details?.type === "order-steps" ? details.steps : undefined;
      return (
        <div>
          <p className="text-muted">Ваш порядок:</p>
          <ol className="mt-1 space-y-1.5">
            {order.map((stepId, index) => {
              const step = exercise.steps.find((s) => s.id === stepId);
              if (!step) return null;
              const item = review?.[step.id];
              return (
                <li key={step.id}>
                  <Marked
                    kind={item ? (item.isCorrect ? "correct" : "wrong") : null}
                    label={`${index + 1}.`}
                  >
                    {step.text}
                    {item && !item.isCorrect && (
                      <span className="text-muted"> · нужно на место {item.position}</span>
                    )}
                  </Marked>
                  {item?.feedback && <p className="mt-0.5 pl-5 text-muted">{item.feedback}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      );
    }

    case "free-answer":
    case "prompt-rewrite": {
      const { text } = answer as { text: unknown };
      if (typeof text !== "string") return null;
      return (
        <div className="space-y-2">
          <p className="text-muted">Ваш ответ:</p>
          <p className="whitespace-pre-line border-l-2 border-border-strong pl-3">{text}</p>
          {details?.type === "free-answer" && Array.isArray(details.criteria) && (
            <>
              <ul className="space-y-1.5">
                {details.criteria.map((criterion) => (
                  <li key={criterion.id}>
                    <Marked kind={criterion.met ? "correct" : "missed"} label={criterion.met ? "Есть" : "Не хватает"}>
                      {criterion.text}
                    </Marked>
                    <p className="mt-0.5 pl-5 text-muted">{criterion.feedback}</p>
                  </li>
                ))}
              </ul>
              <p>
                <span className="font-medium">Образец ответа: </span>
                {details.sample}
              </p>
            </>
          )}
          {details?.type === "prompt-rewrite" && Array.isArray(details.criteria) && (
            <ul className="space-y-1.5">
              {details.criteria.map((criterion) => (
                <li key={criterion.id}>
                  <Marked kind={criterion.found ? "correct" : "missed"} label={criterion.found ? "Есть" : "Не нашли"}>
                    {criterion.label}
                  </Marked>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    case "calibration": {
      const { answers } = answer as CalibrationAnswer;
      if (!isRecord(answers)) return null;
      const review = details?.type === "calibration" ? details.items : undefined;
      return (
        <div className="space-y-2">
          <ol className="space-y-2">
            {exercise.items.map((item, index) => {
              const given = isRecord(answers[item.id]) ? answers[item.id] : undefined;
              const judged = review?.[item.id];
              const mark = judged ? itemMark(judged.confident, judged.correct) : null;
              return (
                <li key={item.id}>
                  <p>
                    {index + 1}. {item.question}
                  </p>
                  <p className="pl-5">
                    «{given?.text ?? "—"}» ·{" "}
                    <span className="text-muted">{given ? (given.confident ? "Точно знаю" : "Сомневаюсь") : "—"}</span>
                  </p>
                  {judged && mark && (
                    <div className="pl-5">
                      <p className={`inline-flex items-center gap-1 font-medium ${mark.mark.text}`}>
                        <mark.mark.Icon size={16} aria-hidden="true" />
                        {mark.label}
                      </p>
                      <p className="text-muted">{judged.feedback}</p>
                      {!judged.correct && <p className="text-muted">Правильный ответ: {judged.expected}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {review && <CalibrationSummary items={Object.values(review)} />}
        </div>
      );
    }
  }
}

// Строка ответа с отметкой: значок и подпись, а не только цвет. kind = null — без отметки
function Marked({
  kind,
  label,
  children,
}: {
  kind: "correct" | "wrong" | "missed" | null;
  label: string | false;
  children?: React.ReactNode;
}) {
  const mark = kind ? REVIEW_MARKS[kind] : null;
  return (
    <p className="flex items-start gap-1.5">
      {/* Без отметки — пустое место той же ширины, чтобы строки не прыгали */}
      {mark ? (
        <mark.Icon size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${mark.text}`} />
      ) : (
        <span aria-hidden="true" className="w-4 shrink-0" />
      )}
      <span>
        {label && <span className={`font-medium ${mark?.text ?? ""}`}>{label}</span>}
        {label && children ? " " : ""}
        {children}
      </span>
    </p>
  );
}
