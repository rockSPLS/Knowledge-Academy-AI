"use client";

import { useId, useState } from "react";
import { Coins, Droplets, Star } from "lucide-react";
import type {
  CostedSelectAnswer,
  CostedSelectReview,
  CostedOptionStatus,
  PublicCostedSelect,
} from "@/lib/exercises/types";
import { plural } from "@/lib/plural";
import { ExerciseShell } from "../ExerciseShell";
import { REVIEW_MARKS, type ReviewMark } from "../reviewMarks";
import { useExercise } from "../useExercise";

// Собственный тип «Цена выбора» (costed-select): у каждого варианта есть цена в токенах,
// нужно собрать промпт — взять нужное и не набрать «воды». Варианты — вперемешку, у части
// сведений есть полная и краткая версии; можно отметить обе, но вторая станет дублем.
// Итог — «Эффективность выбора»: сколько токенов потрачено с пользой, сколько на «воду»
// и на то, что нельзя отдавать модели.

const tokensWord = (count: number) => `${count} ${plural(count, ["токен", "токена", "токенов"])}`;

// «Вода», взятая в промпт, — нейтральная отметка: это не ошибка в фактах, а лишний вес
// (на балл она влияет только через общий элемент «не раздуто»)
const NOISE_MARK: ReviewMark = {
  Icon: Droplets,
  box: "border-border-strong bg-surface",
  text: "text-muted",
};

// Отметка и подпись для каждого статуса разбора; neutral — без отметки
const STATUS_MARKS: Record<
  Exclude<CostedOptionStatus, "neutral">,
  { mark: ReviewMark; label: string }
> = {
  needed: { mark: REVIEW_MARKS.correct, label: "Нужное" },
  "needed-long": { mark: NOISE_MARK, label: "Нужное, но есть короче" },
  duplicate: { mark: NOISE_MARK, label: "Дубль — это уже есть в промпте" },
  noise: { mark: NOISE_MARK, label: "Вода — не помогает задаче" },
  danger: { mark: REVIEW_MARKS.wrong, label: "Нельзя отдавать модели" },
  "danger-avoided": {
    mark: REVIEW_MARKS.correct,
    label: "Верно, что не взяли: это нельзя отдавать модели",
  },
  missed: { mark: REVIEW_MARKS.missed, label: "Пропущено — нужное сведение" },
};

export function CostedSelect({ exercise }: { exercise: PublicCostedSelect }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Пользователь нажал «Проверить», ничего не выбрав
  const [showEmpty, setShowEmpty] = useState(false);
  const idPrefix = useId();
  // Выбранное — в порядке показа, чтобы ответ не зависел от порядка нажатий
  const selectedInOrder = exercise.options
    .filter((option) => selected.has(option.id))
    .map((option) => option.id);
  // Черновик для теста: ответ готов, если выбрано хоть что-то
  const { status, result, revealError, submit, revealAnswer, reset, mode, locked } =
    useExercise<CostedSelectAnswer>(exercise.id, {
      answer: selectedInOrder.length > 0 ? { selected: selectedInOrder } : null,
      touched: selectedInOrder.length > 0,
    });
  const isLocked = locked;

  const used = exercise.options
    .filter((option) => selected.has(option.id))
    .reduce((total, option) => total + option.cost, 0);
  // Шкала до проверки — от размера промпта, если взять всё
  const maxTokens = exercise.options.reduce((total, option) => total + option.cost, 0);
  const isEmpty = selected.size === 0;

  const details = result?.review?.details;
  const review: CostedSelectReview | null = details?.type === "costed-select" ? details : null;

  function toggle(optionId: string) {
    if (isLocked) return;
    setShowEmpty(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(optionId)) next.delete(optionId);
      else next.add(optionId);
      return next;
    });
  }

  const firstOptionId = `${idPrefix}-${exercise.options[0].id}`;

  function handleSubmit() {
    if (isEmpty) {
      setShowEmpty(true);
      document.getElementById(firstOptionId)?.focus();
      return;
    }
    submit({ selected: selectedInOrder });
  }

  function retry() {
    setSelected(new Set());
    setShowEmpty(false);
    reset();
    requestAnimationFrame(() => document.getElementById(firstOptionId)?.focus());
  }

  return (
    <ExerciseShell
      exerciseId={exercise.id}
      typeName="Цена выбора"
      typeIcon={Coins}
      badge={exercise.starred ? { label: "Задача со звёздочкой", Icon: Star } : undefined}
      question={exercise.question}
      instruction="У каждого варианта есть цена в токенах. Выберите, что положить в промпт, — в конце покажем, сколько потрачено с пользой"
      status={status}
      result={result}
      revealError={revealError}
      mode={mode}
      validationMessage={showEmpty && isEmpty ? "Выберите, что положить в промпт" : null}
      onSubmit={handleSubmit}
      onRetry={retry}
      onReveal={revealAnswer}
    >
      {/* Шкала размера остаётся и после раскрытия: видно, сколько набрано */}
      <PromptSize used={used} max={maxTokens} />

      {/* Пустой выбор при проверке — подсвечиваем весь список одной рамкой, как в выборе ответа */}
      <ul
        className={`mt-4 space-y-2 rounded-lg ${
          showEmpty && isEmpty ? "ring-1 ring-accent ring-offset-4 ring-offset-surface" : ""
        }`}
      >
        {exercise.options.map((option) => {
          const optionReview = review?.options[option.id];
          const marked =
            optionReview && optionReview.status !== "neutral"
              ? STATUS_MARKS[optionReview.status]
              : null;
          const isSelected = selected.has(option.id);
          const markId = `${idPrefix}-${option.id}-mark`;

          return (
            <li
              key={option.id}
              className={`rounded-lg border p-2 transition-colors ${
                marked ? marked.mark.box : "border-border bg-background"
              }`}
            >
              <button
                id={`${idPrefix}-${option.id}`}
                type="button"
                onClick={() => toggle(option.id)}
                disabled={isLocked}
                aria-pressed={isSelected}
                // Диктор прочитает отметку разбора вместе с вариантом
                aria-describedby={marked ? markId : undefined}
                className={`w-full rounded-md border px-3 py-1.5 text-left text-sm transition-colors ${
                  isSelected
                    ? isLocked
                      ? // В разборе выбранное — только рамкой: заливка смешалась бы с цветом отметки
                        "border-accent bg-background"
                      : "border-accent bg-accent-soft text-accent-soft-foreground"
                    : isLocked
                      ? "border-transparent bg-transparent text-muted"
                      : "border-border-strong bg-surface hover:border-accent"
                }`}
              >
                {option.text}
                <span className="ml-1.5 whitespace-nowrap text-muted">
                  · {tokensWord(option.cost)}
                </span>
              </button>

              {/* Разбор: что это за вариант и верно ли решение о нём */}
              {marked && (
                <div id={markId} className="mt-1.5 px-1 text-sm">
                  <p className={`inline-flex items-center gap-1 font-medium ${marked.mark.text}`}>
                    <marked.mark.Icon size={16} aria-hidden="true" />
                    {marked.label}
                  </p>
                  {optionReview?.feedback && (
                    <p className="mt-1 text-muted">{optionReview.feedback}</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Итог — под вариантами, рядом с итогом проверки: сначала разбор по вариантам, потом вывод */}
      {review && (
        <div className="mt-4">
          <Composition composition={review.composition} needed={review.needed} />
        </div>
      )}
    </ExerciseShell>
  );
}

// ---------- Размер и состав промпта ----------

// Сколько токенов набрано — до и после проверки. Шкала — от размера «взять всё»
function PromptSize({ used, max }: { used: number; max: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>Размер промпта</span>
        {/* Диктор услышит, как меняется размер */}
        <span aria-live="polite" className="text-muted">
          <span className="sr-only">Размер промпта: </span>
          {tokensWord(used)}
        </span>
      </div>
      <div className="mt-1.5 h-3 overflow-hidden rounded bg-border" aria-hidden="true">
        <div
          className="h-full bg-accent-fill transition-[width] duration-200"
          style={{ width: `${(used / max) * 100}%` }}
        />
      </div>
    </div>
  );
}

// После проверки — «Эффективность выбора»: из чего состоит промпт, доли от его размера
// цветом и подписями; в заголовке — главная цифра, сколько потрачено с пользой
function Composition({
  composition,
  needed,
}: {
  composition: CostedSelectReview["composition"];
  needed: CostedSelectReview["needed"];
}) {
  // Ключи — те же, что у состава в разборе: опечатку в сравнении поймает TypeScript
  const base: {
    key: keyof CostedSelectReview["composition"];
    label: string;
    amount: number;
    swatch: string;
  }[] = [
    { key: "useful", label: "Полезное", amount: composition.useful, swatch: "bg-success" },
    { key: "noise", label: "Вода", amount: composition.noise, swatch: "bg-subtle" },
    { key: "danger", label: "Нельзя отдавать", amount: composition.danger, swatch: "bg-danger" },
  ];
  const percents = wholePercents(base.map((part) => part.amount));
  const parts = base.map((part, index) => ({ ...part, percent: percents[index] }));
  const usefulPercent = parts.find((part) => part.key === "useful")?.percent ?? 0;

  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium">Эффективность выбора</span>
        <span>с пользой — {usefulPercent} % промпта</span>
      </div>
      <div className="mt-1.5 flex h-3 overflow-hidden rounded bg-border" aria-hidden="true">
        {parts.map((part) => (
          <div
            key={part.key}
            className={part.swatch}
            style={{ width: `${part.percent}%` }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts
          .filter((part) => part.amount > 0 || part.key === "useful")
          .map((part) => (
            <li key={part.key} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${part.swatch}`} aria-hidden="true" />
              {part.label} — {tokensWord(part.amount)} ({part.percent} %)
            </li>
          ))}
      </ul>
      {/* Эффективность считается только от набранного: 100 % бывает и у неполного промпта —
          поэтому рядом полнота */}
      <p className="mt-2 text-sm text-muted">
        Доли считаются от набранного промпта. Нужных сведений в нём: {needed.included} из{" "}
        {needed.total}.
      </p>
    </div>
  );
}

// Доли в целых процентах, которые в сумме дают ровно 100: округляем вниз,
// а недостающие единицы отдаём долям с наибольшим остатком
function wholePercents(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  // Пустой промпт до разбора не доходит (сервер его отклоняет), но делить на ноль не будем
  if (total === 0) return values.map(() => 0);
  const exact = values.map((value) => (value / total) * 100);
  const result = exact.map(Math.floor);
  const missing = 100 - result.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < missing; i++) result[byRemainder[i].index]++;
  return result;
}
