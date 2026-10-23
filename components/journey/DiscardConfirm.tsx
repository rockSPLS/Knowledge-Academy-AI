"use client";

import { useEffect, useRef } from "react";
import { Download } from "lucide-react";

// Подтверждение «Новое путешествие»: текущее путешествие удалится, а заново составить его —
// снова запросы к модели. На итогах — тоже: там все ответы, и удаление без возврата.
// Кнопка одна на всех этапах — в шапке путешествия (JourneyApp.tsx).
// onDownload — на итогах: «Скачать» прямо здесь, сохранить итоги в одно касание

export function DiscardConfirm({
  finished,
  onConfirm,
  onCancel,
  onDownload,
}: {
  finished: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDownload?: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div role="group" aria-label="Подтверждение" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm print:hidden">
      <p>
        {finished
          ? "Итоги удалятся. Чтобы сохранить их, сначала нажмите «Скачать». Начать новое?"
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
        {/* На итогах подтверждение открывается вверху, а кнопки отчёта стоят ниже карточки итогов
            (на телефоне — за краем экрана): сохранить можно прямо отсюда */}
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-background px-3 py-1.5 font-medium hover:bg-border"
          >
            <Download size={16} aria-hidden="true" />
            Скачать
          </button>
        )}
      </div>
    </div>
  );
}
