"use client";

import { useId, useState } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, GripVertical, ListOrdered } from "lucide-react";
import type { OrderStepsAnswer, OrderStepsReview, PublicOrderSteps } from "@/lib/exercises/types";
import { ExerciseShell } from "../ExerciseShell";
import { REVIEW_MARKS, type ReviewMark } from "../reviewMarks";
import { useExercise } from "../useExercise";

// Упражнение «Расставьте шаги»: шаги выстраивают по порядку — перетаскиванием
// (мышью или долгим нажатием пальца) или кнопками «выше / ниже». Кнопки — запасной
// способ без перетаскивания (WCAG 2.2, п. 2.5.7), он же работает с клавиатуры.

// Скрытая подсказка, которую библиотека всё равно добавляет на страницу (по умолчанию —
// английская). К шагам она не привязана — их атрибуты мы не ставим, — поэтому диктор её
// не читает; переводим, чтобы на странице не было английского текста. Озвучиваются
// только сообщения о перетаскивании (announcements).
const SCREEN_READER_INSTRUCTIONS =
  "Чтобы переместить шаг, используйте кнопки «выше» и «ниже» рядом с ним. Шаг можно и перетащить мышью или пальцем.";

export function OrderSteps({ exercise }: { exercise: PublicOrderSteps }) {
  const { status, result, revealError, submit, revealAnswer, reset, mode } =
    useExercise<OrderStepsAnswer>(exercise.id);
  const initialOrder = exercise.steps.map((step) => step.id);
  // Текущий порядок шагов (id)
  const [order, setOrder] = useState<string[]>(initialOrder);
  // Сообщение для экранного диктора при работе кнопками
  const [liveMessage, setLiveMessage] = useState("");
  // Пользователь нажал «Проверить», не переставив ни одного шага
  const [showUnchanged, setShowUnchanged] = useState(false);
  const idPrefix = useId();
  // Свой id для библиотеки: иначе её внутренние id на сервере и в браузере
  // не совпадут и React сообщит об ошибке гидратации
  const dndId = useId();

  const sensors = useSensors(
    // Мышь: перетаскивание начинается после сдвига на 5 px, обычный клик остаётся кликом
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Палец: долгое нажатие берёт шаг, обычный свайп прокручивает страницу
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const isLocked = status !== "idle" && status !== "error";
  // Исходный порядок перемешан, поэтому ответ «заполнен» сразу. Без единой перестановки
  // не проверяем — иначе баллы можно получить за чужую перестановку.
  const isChanged = order.some((id, index) => id !== initialOrder[index]);
  const total = order.length;

  const details = result?.review?.details;
  const review: OrderStepsReview | null = details?.type === "order-steps" ? details : null;

  const stepText = (id: string) => exercise.steps.find((step) => step.id === id)?.text ?? "";

  // Сообщение для экранного диктора. Если текст совпадает с предыдущим, добавляем
  // неразрывный пробел: иначе React не обновит область и диктор промолчит.
  function announce(message: string) {
    setLiveMessage((prev) => (prev === message ? `${message} ` : message));
  }

  // Кнопки «выше / ниже»: шаг меняется местами с соседом
  function move(id: string, delta: -1 | 1) {
    if (isLocked) return;
    const from = order.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= total) return;
    setOrder(arrayMove(order, from, to));
    announce(`Шаг перемещён на позицию ${to + 1} из ${total}.`);
    // При перемещении вниз React переносит в DOM сам шаг вместе с нажатой кнопкой,
    // и фокус слетает в начало страницы — возвращаем его на ту же кнопку
    requestAnimationFrame(() =>
      document.getElementById(`${idPrefix}-${id}-${delta < 0 ? "up" : "down"}`)?.focus(),
    );
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    setOrder((prev) =>
      arrayMove(prev, prev.indexOf(String(active.id)), prev.indexOf(String(over.id))),
    );
  }

  // Позиция шага для озвучки перетаскивания
  const positionOf = (id: UniqueIdentifier | undefined) =>
    id === undefined ? null : order.indexOf(String(id)) + 1;

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Взят шаг ${positionOf(active.id)} из ${total}: ${stepText(String(active.id))}.`,
    onDragOver: ({ over }) => {
      const position = positionOf(over?.id);
      return position ? `Над позицией ${position} из ${total}.` : "Вне списка.";
    },
    onDragEnd: ({ active, over }) => {
      const position = positionOf(over?.id);
      if (!position || active.id === over?.id) return "Шаг остался на месте.";
      return `Шаг поставлен на позицию ${position} из ${total}.`;
    },
    onDragCancel: () => "Перетаскивание отменено.",
  };

  function handleSubmit() {
    if (!isChanged) {
      setShowUnchanged(true);
      // Фокус — на кнопку «ниже» у первого шага: с неё удобно начать
      document.getElementById(`${idPrefix}-${order[0]}-down`)?.focus();
      return;
    }
    submit({ order });
  }

  function retry() {
    setOrder(initialOrder);
    setShowUnchanged(false);
    setLiveMessage("");
    reset();
    requestAnimationFrame(() =>
      document.getElementById(`${idPrefix}-${initialOrder[0]}-down`)?.focus(),
    );
  }

  return (
    <ExerciseShell
      typeName="Расставьте шаги"
      typeIcon={ListOrdered}
      question={exercise.question}
      instruction="Перетащите шаги в нужном порядке или передвигайте их стрелками"
      status={status}
      result={result}
      revealError={revealError}
      mode={mode}
      validationMessage={
        showUnchanged && !isChanged ? "Расставьте шаги в нужном порядке" : null
      }
      onSubmit={handleSubmit}
      onRetry={retry}
      onReveal={revealAnswer}
    >
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: SCREEN_READER_INSTRUCTIONS },
        }}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {order.map((id, index) => {
              const stepReview = review?.steps[id];
              const mark = stepReview
                ? REVIEW_MARKS[stepReview.isCorrect ? "correct" : "wrong"]
                : undefined;
              return (
                <SortableStep
                  key={id}
                  id={id}
                  idPrefix={idPrefix}
                  text={stepText(id)}
                  position={index + 1}
                  total={total}
                  isUnchangedWarning={showUnchanged && !isChanged}
                  disabled={isLocked}
                  mark={mark}
                  review={stepReview}
                  isAllCorrect={result?.verdict === "correct"}
                  onMove={(delta) => move(id, delta)}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>

      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
    </ExerciseShell>
  );
}

// ---------- Шаг списка ----------

// Кнопки «выше / ниже». aria-disabled вместо disabled: у крайнего шага кнопка
// становится неактивной, но фокус на ней сохраняется
const MOVE_BUTTON =
  "rounded-md p-1.5 text-subtle transition-colors hover:bg-border hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-30";

function SortableStep({
  id,
  idPrefix,
  text,
  position,
  total,
  isUnchangedWarning,
  disabled,
  mark,
  review,
  isAllCorrect,
  onMove,
}: {
  id: string;
  idPrefix: string;
  text: string;
  position: number;
  total: number;
  isUnchangedWarning: boolean;
  disabled: boolean;
  mark: ReviewMark | undefined;
  review: OrderStepsReview["steps"][string] | undefined;
  // Весь ответ верный: тогда «Можно не трогать» звучит странно — пишем «На месте»
  isAllCorrect: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({ id, disabled });
  const isFirst = position === 1;
  const isLast = position === total;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex items-center gap-2 rounded-lg border p-2 transition-colors ${
        mark
          ? mark.box
          : isUnchangedWarning
            ? "border-accent bg-background ring-1 ring-accent"
            : "border-border-strong bg-background"
      } ${isDragging ? "z-10 shadow-lg" : ""}`}
    >
      {/* Ручка: шаг тащат только за левый блок с точками и номером — так случайный сдвиг
          мыши при клике по тексту не переставит шаг. Блок растянут на всю высоту карточки,
          чтобы в него было легко попасть пальцем. Атрибуты библиотеки (role="button",
          tabIndex) не ставим: с клавиатуры шаг двигают кнопками «выше / ниже». */}
      <span
        ref={setActivatorNodeRef}
        {...listeners}
        className={`-my-2 -ml-2 flex shrink-0 items-center gap-1.5 self-stretch py-2 pr-1 pl-2 ${
          disabled
            ? ""
            : "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] active:cursor-grabbing"
        }`}
      >
        {/* После проверки значок только прячем, а не убираем — чтобы текст шагов не сдвигался */}
        <GripVertical
          size={16}
          aria-hidden="true"
          className={disabled ? "invisible" : "text-subtle"}
        />
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-soft text-sm font-semibold text-accent-soft-foreground">
          {position}
        </span>
      </span>

      <div className="min-w-0 flex-1">
        <p>{text}</p>
        {/* Разбор: шаг можно не трогать (он стоит верно относительно других и встанет
            на место, когда переставят остальные) или его нужно переставить — и куда */}
        {review && mark && (
          <div className="mt-1 text-sm">
            <p className={`inline-flex items-center gap-1 font-medium ${mark.text}`}>
              <mark.Icon size={16} aria-hidden="true" />
              {review.isCorrect
                ? isAllCorrect
                  ? "На месте"
                  : "Можно не трогать"
                : `Нужно переставить на место ${review.position}`}
            </p>
            {review.feedback && <p className="mt-1 text-muted">{review.feedback}</p>}
          </div>
        )}
      </div>

      {!disabled && (
        // Стрелки друг над другом: «выше» сверху, «ниже» снизу — и тексту остаётся больше места
        <span className="-my-1 flex shrink-0 flex-col">
          <button
            id={`${idPrefix}-${id}-up`}
            type="button"
            onClick={() => {
              if (!isFirst) onMove(-1);
            }}
            aria-disabled={isFirst}
            aria-label={`Переместить шаг «${text}» выше`}
            title="Выше"
            className={MOVE_BUTTON}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          <button
            id={`${idPrefix}-${id}-down`}
            type="button"
            onClick={() => {
              if (!isLast) onMove(1);
            }}
            aria-disabled={isLast}
            aria-label={`Переместить шаг «${text}» ниже`}
            title="Ниже"
            className={MOVE_BUTTON}
          >
            <ArrowDown size={16} aria-hidden="true" />
          </button>
        </span>
      )}
    </li>
  );
}
