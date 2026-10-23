"use client";

import { useEffect, useRef } from "react";

// Подтверждение «Новое путешествие»: текущее путешествие удалится, а заново составить его —
// снова запросы к модели. На итогах — тоже: там все ответы, и удаление без возврата.
// Общее для шапки путешествия и экрана итогов

export function DiscardConfirm({
  finished,
  onConfirm,
  onCancel,
}: {
  finished: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div role="group" aria-label="Подтверждение" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm print:hidden">
      <p>
        {finished
          ? "Итоги удалятся. Чтобы сохранить их, сначала нажмите «Печать / PDF». Начать новое?"
          : "Текущее путешествие и его прогресс удалятся. Начать новое?"}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className="rounded-md border border-border-strong bg-background px-3 py-1.5 font-medium hover:bg-border"
        >
          Да, начать новое
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-transparent bg-accent-soft px-3 py-1.5 font-medium text-accent-soft-foreground hover:border-accent"
        >
          {finished ? "Вернуться к итогам" : "Продолжить это"}
        </button>
      </div>
    </div>
  );
}
