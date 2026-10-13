"use client";

import { useId, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { GripVertical, Link2, X } from "lucide-react";
import type { MatchPairsAnswer, MatchPairsReview, PublicMatchPairs } from "@/lib/exercises/types";
import { ExerciseShell } from "../ExerciseShell";
import { REVIEW_MARKS, type ReviewMark } from "../reviewMarks";
import { useExercise } from "../useExercise";

// Упражнение «Соедините пары»: рядом с каждым термином — пустая ячейка,
// под ними — стопка определений. Определение можно перетащить в ячейку
// (мышью или пальцем) или поставить нажатиями: сначала определение, потом ячейка.
// Второй способ работает и с клавиатуры (Tab и Enter) — он обязателен по WCAG 2.2 (п. 2.5.7).

// id зоны «стопка»; ячейки — `slot:<id термина>`
const BANK_ID = "bank";
const SLOT_PREFIX = "slot:";

// Тексты для экранного диктора при перетаскивании (по умолчанию в библиотеке — английские)
const SCREEN_READER_INSTRUCTIONS =
  "Чтобы поставить определение к термину, выберите его нажатием, затем нажмите ячейку у нужного термина. Определение можно и перетащить мышью или пальцем.";

// Куда упала карточка: в первую очередь — зона под курсором или пальцем.
// Широкая карточка может задевать две ячейки сразу, и выбор по площади
// пересечения поставил бы её не туда, куда указывает пользователь.
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};

export function MatchPairs({ exercise }: { exercise: PublicMatchPairs }) {
  const { status, result, revealError, submit, revealAnswer, reset, mode } =
    useExercise<MatchPairsAnswer>(exercise.id);
  // id термина → id поставленного к нему определения
  const [placed, setPlaced] = useState<Record<string, string>>({});
  // Определение, выбранное нажатием (ждёт, когда пользователь нажмёт ячейку)
  const [selected, setSelected] = useState<string | null>(null);
  // Определение, которое сейчас перетаскивают
  const [dragging, setDragging] = useState<string | null>(null);
  // Сообщение для экранного диктора при работе нажатиями
  const [liveMessage, setLiveMessage] = useState("");
  // Пользователь пытался проверить, заполнив не все ячейки — подсвечиваем пустые
  const [showMissing, setShowMissing] = useState(false);
  const idPrefix = useId();
  // Свой id для библиотеки: иначе её внутренние id на сервере и в браузере
  // не совпадут и React сообщит об ошибке гидратации
  const dndId = useId();

  const sensors = useSensors(
    // Мышь: перетаскивание начинается после сдвига на 5 px, обычный клик остаётся кликом
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Палец: долгое нажатие берёт карточку, обычный свайп прокручивает страницу
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const isLocked = status !== "idle" && status !== "error";
  const isComplete = exercise.terms.every((term) => Object.hasOwn(placed, term.id));
  // Стопка — определения, которые ещё не стоят в ячейках (в авторском порядке)
  const placedIds = new Set(Object.values(placed));
  const bank = exercise.definitions.filter((definition) => !placedIds.has(definition.id));

  const details = result?.review?.details;
  const review: MatchPairsReview | null = details?.type === "match-pairs" ? details : null;

  const definitionText = (id: string) =>
    exercise.definitions.find((definition) => definition.id === id)?.text ?? "";
  const termText = (id: string) => exercise.terms.find((term) => term.id === id)?.text ?? "";

  // Ставит определение к термину. Если оно стояло в другой ячейке — та освобождается;
  // если ячейка была занята — прежнее определение возвращается в стопку.
  // Возвращает сообщение для экранного диктора.
  function place(definitionId: string, termId: string): string {
    const displaced = placed[termId];
    setPlaced((prev) => {
      const next: Record<string, string> = {};
      for (const [term, definition] of Object.entries(prev)) {
        if (definition !== definitionId) next[term] = definition;
      }
      next[termId] = definitionId;
      return next;
    });
    const message = `Определение поставлено к термину «${termText(termId)}».`;
    return displaced && displaced !== definitionId
      ? `${message} Прежнее определение возвращено в стопку.`
      : message;
  }

  function returnToBank(definitionId: string) {
    setPlaced((prev) => {
      const next: Record<string, string> = {};
      for (const [term, definition] of Object.entries(prev)) {
        if (definition !== definitionId) next[term] = definition;
      }
      return next;
    });
  }

  // Сообщение для экранного диктора. Если текст совпадает с предыдущим, добавляем
  // неразрывный пробел: иначе React не обновит область и диктор промолчит.
  function announce(message: string) {
    setLiveMessage((prev) => (prev === message ? `${message} ` : message));
  }

  // Фокус после того, как нажатая кнопка исчезла (ячейка заполнилась или опустела),
  // — иначе клавиатура и диктор «теряются» в начале страницы
  function focusLater(elementId: string) {
    requestAnimationFrame(() => document.getElementById(elementId)?.focus());
  }

  // Нажатие на определение (в стопке или в ячейке). Клик, которым закончилось
  // перетаскивание, сюда не доходит — его гасит сама библиотека.
  function handleCardClick(definitionId: string, slotTermId?: string) {
    if (isLocked) return;
    // Выбрано другое определение, а нажата карточка в ячейке — ставим выбранное на её место
    if (selected && selected !== definitionId && slotTermId) {
      announce(place(selected, slotTermId));
      setSelected(null);
      return;
    }
    if (selected === definitionId) {
      setSelected(null);
      announce("Выбор снят.");
    } else {
      setSelected(definitionId);
      announce("Определение выбрано. Теперь нажмите ячейку у нужного термина.");
    }
  }

  // Нажатие на пустую ячейку
  function handleSlotClick(termId: string) {
    if (isLocked) return;
    if (!selected) {
      announce("Сначала выберите определение в стопке.");
      return;
    }
    announce(place(selected, termId));
    setSelected(null);
    // Кнопка пустой ячейки исчезла — фокус на поставленную карточку
    focusLater(`${idPrefix}-${selected}-card`);
  }

  function handleRemove(termId: string) {
    if (isLocked) return;
    const definitionId = placed[termId];
    if (!definitionId) return;
    returnToBank(definitionId);
    if (selected === definitionId) setSelected(null);
    announce(`Определение убрано от термина «${termText(termId)}» и возвращено в стопку.`);
    // Карточка и крестик исчезли — фокус на опустевшую ячейку
    focusLater(`${idPrefix}-${termId}-slot`);
  }

  function handleDragStart(event: DragStartEvent) {
    setDragging(String(event.active.id));
    setSelected(null);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    if (!over) return;
    const definitionId = String(active.id);
    const overId = String(over.id);
    if (overId === BANK_ID) returnToBank(definitionId);
    else if (overId.startsWith(SLOT_PREFIX)) place(definitionId, overId.slice(SLOT_PREFIX.length));
  }

  // Что озвучивает диктор при перетаскивании
  function describeTarget(id: UniqueIdentifier | undefined): string | null {
    if (id === undefined) return null;
    const overId = String(id);
    if (overId === BANK_ID) return "стопка определений";
    if (overId.startsWith(SLOT_PREFIX)) {
      return `ячейка термина «${termText(overId.slice(SLOT_PREFIX.length))}»`;
    }
    return null;
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Взято определение: ${definitionText(String(active.id))}.`,
    onDragOver: ({ over }) => {
      const target = describeTarget(over?.id);
      return target ? `Над: ${target}.` : "Не над ячейкой.";
    },
    onDragEnd: ({ active, over }) => {
      const target = describeTarget(over?.id);
      if (!target) return "Определение не поставлено.";
      const overId = String(over?.id);
      if (overId === BANK_ID) return "Определение возвращено в стопку.";
      // Озвучка срабатывает до обновления состояния — в placed ещё прежнее содержимое ячейки
      const displaced = placed[overId.slice(SLOT_PREFIX.length)];
      return displaced && displaced !== String(active.id)
        ? `Определение поставлено: ${target}. Прежнее определение возвращено в стопку.`
        : `Определение поставлено: ${target}.`;
    },
    onDragCancel: () => "Перетаскивание отменено.",
  };

  function handleSubmit() {
    if (!isComplete) {
      setShowMissing(true);
      // Фокус — на первую пустую ячейку
      const firstEmpty = exercise.terms.find((term) => !Object.hasOwn(placed, term.id));
      if (firstEmpty) document.getElementById(`${idPrefix}-${firstEmpty.id}-slot`)?.focus();
      return;
    }
    setSelected(null);
    submit({ matches: placed });
  }

  function retry() {
    setShowMissing(false);
    setPlaced({});
    setSelected(null);
    setLiveMessage("");
    reset();
    const first = exercise.definitions[0];
    requestAnimationFrame(() =>
      document.getElementById(`${idPrefix}-${first.id}-card`)?.focus(),
    );
  }

  return (
    <ExerciseShell
      typeName="Соедините пары"
      typeIcon={Link2}
      question={exercise.question}
      instruction="Перетащите к каждому термину его определение — или нажмите определение, а затем ячейку"
      status={status}
      result={result}
      revealError={revealError}
      mode={mode}
      validationMessage={showMissing && !isComplete ? "Заполните все пары" : null}
      onSubmit={handleSubmit}
      onRetry={retry}
      onReveal={revealAnswer}
    >
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: SCREEN_READER_INSTRUCTIONS },
        }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <ul className="space-y-3">
          {exercise.terms.map((term) => {
            const definitionId = placed[term.id];
            const termReview = review?.terms[term.id];
            const mark = termReview
              ? REVIEW_MARKS[termReview.isCorrect ? "correct" : "wrong"]
              : undefined;

            return (
              <li
                key={term.id}
                className="grid gap-1.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:items-center sm:gap-3"
              >
                <span className="font-medium">{term.text}</span>
                <Slot
                  id={`${idPrefix}-${term.id}-slot`}
                  termId={term.id}
                  termText={term.text}
                  isMissing={showMissing && !definitionId}
                  hasSelection={selected !== null}
                  mark={mark}
                  disabled={isLocked}
                  onClick={() => handleSlotClick(term.id)}
                >
                  {definitionId && (
                    <>
                      <DefinitionCard
                        id={definitionId}
                        domId={`${idPrefix}-${definitionId}-card`}
                        text={definitionText(definitionId)}
                        // Для диктора: к какому термину стоит карточка и что сделает нажатие
                        label={
                          selected && selected !== definitionId
                            ? `Поставить выбранное определение к термину «${term.text}» вместо: ${definitionText(definitionId)}`
                            : `${definitionText(definitionId)} (у термина «${term.text}»)`
                        }
                        isSelected={selected === definitionId}
                        isDragging={dragging === definitionId}
                        disabled={isLocked}
                        onClick={() => handleCardClick(definitionId, term.id)}
                      />
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => handleRemove(term.id)}
                          aria-label={`Убрать определение от термина «${term.text}»`}
                          title="Вернуть в стопку"
                          className="shrink-0 rounded-md px-2 text-subtle transition-colors hover:bg-border hover:text-foreground"
                        >
                          <X size={16} aria-hidden="true" />
                        </button>
                      )}
                    </>
                  )}
                </Slot>

                {/* Разбор: соединено верно или нет; при ошибке — правильное определение и пояснение */}
                {termReview && mark && (
                  <div className="text-sm sm:col-start-2">
                    <p className={`inline-flex items-center gap-1 font-medium ${mark.text}`}>
                      <mark.Icon size={16} aria-hidden="true" />
                      {termReview.isCorrect ? "Соединено верно" : "Ошибка"}
                    </p>
                    {!termReview.isCorrect && (
                      <p className="mt-1">Правильно: {definitionText(termReview.expected)}</p>
                    )}
                    {termReview.feedback && (
                      <p className="mt-1 text-muted">{termReview.feedback}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* После проверки все определения стоят в ячейках — стопка не нужна */}
        {!isLocked && (
          <Bank
            definitions={bank}
            idPrefix={idPrefix}
            selected={selected}
            dragging={dragging}
            onCardClick={handleCardClick}
          />
        )}

        {/* Карточка, которая едет за курсором или пальцем */}
        <DragOverlay>
          {dragging ? <CardBody text={definitionText(dragging)} /> : null}
        </DragOverlay>
      </DndContext>

      <p aria-live="polite" className="sr-only">
        {liveMessage}
      </p>
    </ExerciseShell>
  );
}

// ---------- Части упражнения ----------

// Ячейка рядом с термином: сюда кладут определение (перетаскиванием или нажатием)
function Slot({
  id,
  termId,
  termText,
  isMissing,
  hasSelection,
  mark,
  disabled,
  onClick,
  children,
}: {
  id: string;
  termId: string;
  termText: string;
  isMissing: boolean;
  hasSelection: boolean;
  mark: ReviewMark | undefined;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${SLOT_PREFIX}${termId}`, disabled });
  const isEmpty = !children;

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-12 items-stretch gap-1 rounded-lg border p-1 transition-colors ${
        mark
          ? mark.box
          : isOver
            ? "border-accent bg-accent-soft"
            : isMissing
              ? "border-dashed border-accent bg-background ring-1 ring-accent"
              : isEmpty
                ? "border-dashed border-border-strong bg-background"
                : "border-border bg-background"
      }`}
    >
      {isEmpty ? (
        <button
          id={id}
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={
            hasSelection
              ? `Поставить выбранное определение к термину «${termText}»`
              : `Пустая ячейка для термина «${termText}»`
          }
          className="w-full rounded-md px-2 text-left text-sm text-subtle"
        >
          {hasSelection ? "Нажмите, чтобы поставить сюда" : "Перетащите сюда определение"}
        </button>
      ) : (
        children
      )}
    </div>
  );
}

// Стопка определений, которые ещё не стоят в ячейках
function Bank({
  definitions,
  idPrefix,
  selected,
  dragging,
  onCardClick,
}: {
  definitions: { id: string; text: string }[];
  idPrefix: string;
  selected: string | null;
  dragging: string | null;
  onCardClick: (definitionId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: BANK_ID });
  const headingId = `${idPrefix}-bank`;

  return (
    <div
      ref={setNodeRef}
      className={`mt-5 rounded-lg border p-3 transition-colors ${
        isOver ? "border-accent bg-accent-soft" : "border-border bg-background"
      }`}
    >
      <p id={headingId} className="text-sm text-muted">
        Определения
      </p>
      {definitions.length > 0 ? (
        <ul aria-labelledby={headingId} className="mt-2 space-y-2">
          {definitions.map((definition) => (
            <li key={definition.id}>
              <DefinitionCard
                id={definition.id}
                domId={`${idPrefix}-${definition.id}-card`}
                text={definition.text}
                isSelected={selected === definition.id}
                isDragging={dragging === definition.id}
                disabled={false}
                onClick={() => onCardClick(definition.id)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-subtle">
          Все определения расставлены. Перетащите определение сюда, чтобы убрать его из ячейки.
        </p>
      )}
    </div>
  );
}

// Карточка определения: её можно перетащить или выбрать нажатием
function DefinitionCard({
  id,
  domId,
  text,
  label,
  isSelected,
  isDragging,
  disabled,
  onClick,
}: {
  id: string;
  domId: string;
  text: string;
  // Имя для экранного диктора, если одного текста определения мало
  label?: string;
  isSelected: boolean;
  isDragging: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id, disabled });

  return (
    <button
      ref={setNodeRef}
      id={domId}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={isSelected}
      // Библиотека называет элемент «draggable» — убираем: диктор должен объявлять
      // обычную кнопку (с клавиатуры карточку не тащат, а выбирают нажатием)
      aria-roledescription={undefined}
      // Выбор долгим нажатием на телефоне не должен выделять текст и открывать меню
      className={`flex w-full min-w-0 items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors select-none touch-manipulation [-webkit-touch-callout:none] ${
        disabled ? "cursor-default border-transparent" : "cursor-grab"
      } ${
        isSelected
          ? "border-accent bg-accent-soft text-accent-soft-foreground ring-1 ring-accent"
          : disabled
            ? ""
            : "border-border-strong bg-surface hover:border-accent"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      {!disabled && (
        <GripVertical size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-subtle" />
      )}
      <span className="min-w-0 flex-1">{text}</span>
    </button>
  );
}

// Внешний вид карточки под курсором во время перетаскивания
function CardBody({ text }: { text: string }) {
  return (
    <div className="flex cursor-grabbing items-start gap-2 rounded-md border border-accent bg-surface px-3 py-2 text-sm shadow-lg">
      <GripVertical size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-subtle" />
      <span className="min-w-0 flex-1">{text}</span>
    </div>
  );
}
