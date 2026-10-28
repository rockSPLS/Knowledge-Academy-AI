"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

// Подтверждение удаления прямо на месте кнопки: «Удалить» и «Отмена». Удаление
// без возврата, поэтому фокус сначала на «Отмена»: двойное нажатие Enter ничего не удаляет.
// Вопрос связан с группой — диктор читает его вместе с кнопкой; Esc — то же, что «Отмена».
// extra — ещё кнопки (например, «Скачать» итоги перед удалением)

export function ConfirmDelete({
  message,
  onConfirm,
  onCancel,
  extra,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      role="group"
      aria-label="Подтверждение"
      aria-describedby={messageId}
      onKeyDown={onKeyDown}
      className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm print:hidden"
    >
      <p id={messageId}>{message}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md border border-border-strong bg-background px-3 py-1.5 font-medium hover:bg-border"
        >
          Удалить
        </button>
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="rounded-md border border-transparent bg-accent-soft px-3 py-1.5 font-medium text-accent-soft-foreground hover:border-accent"
        >
          Отмена
        </button>
        {extra}
      </div>
    </div>
  );
}

// Состояние подтверждения для кнопки «Удалить», которая его открывает. Пока подтверждение
// открыто, кнопки нет, поэтому после «Отмена» фокус возвращается на неё — иначе он
// остался бы нигде. triggerRef — на эту кнопку
export function useConfirmDelete() {
  const [isConfirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!isConfirming && returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [isConfirming]);

  return {
    isConfirming,
    triggerRef,
    open: () => setConfirming(true),
    cancel: () => {
      returnFocus.current = true;
      setConfirming(false);
    },
    // После удаления кнопки уже нет — куда перевести фокус, решает место вызова
    close: () => setConfirming(false),
  };
}
