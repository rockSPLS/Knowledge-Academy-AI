"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, ShieldAlert, TriangleAlert } from "lucide-react";
import { MAX_SOURCE_LENGTH } from "@/lib/llm/limits";
import { formatTime } from "@/lib/journey/timing";
import { generateJourney, loadFixtureJourney, type GeneratedJourney } from "./api";

// Форма путешествия: тема или вставленный текст. Пока идёт генерация, её можно
// отменить — запрос обрывается, и сервер прекращает запросы к модели
// (так же, как если закрыть страницу).

// Только при разработке: примеры путешествий из сохранённых ответов модели
// (POST /api/journey/dev) — экраны можно проверять без запросов к модели
const DEV_FIXTURES = [
  { id: "photosynthesis", label: "Фотосинтез" },
  { id: "inflation", label: "Инфляция" },
  { id: "dough", label: "Тесто (текст со спорным утверждением)" },
];
const IS_DEV = process.env.NODE_ENV === "development";

export function JourneyForm({ onCreated }: { onCreated: (generated: GeneratedJourney) => void }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setGenerating] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const fieldId = useId();
  const hintId = useId();
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Ушли со страницы во время генерации — отменяем запрос
  useEffect(() => () => controller.current?.abort(), []);

  // Сообщение об ошибке — в фокус, чтобы его прочитал экранный диктор и увидела клавиатура
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const trimmed = source.trim();
  const isTooLong = source.length > MAX_SOURCE_LENGTH;

  async function run(request: (signal: AbortSignal) => Promise<GeneratedJourney>) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setError(null);
    setGenerating(true);
    setStartedAt(Date.now());
    try {
      onCreated(await request(current.signal));
    } catch (caught) {
      if (current.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Что-то пошло не так. Попробуйте ещё раз.");
    } finally {
      if (controller.current === current) {
        controller.current = null;
        setGenerating(false);
      }
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isGenerating) return;
    if (!trimmed) {
      setError("Введите тему или вставьте текст");
      return;
    }
    if (isTooLong) {
      setError(`Текст длиннее ${MAX_SOURCE_LENGTH.toLocaleString("ru-RU")} символов — сократите его`);
      return;
    }
    void run((signal) => generateJourney(trimmed, signal));
  }

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setGenerating(false);
  }

  if (isGenerating) return <Generating startedAt={startedAt} onCancel={cancel} />;

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <label htmlFor={fieldId} className="block font-medium">
          Тема или текст
        </label>
        <textarea
          id={fieldId}
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setError(null);
          }}
          rows={6}
          placeholder="Например: «Фотосинтез» — или вставьте текст статьи"
          aria-describedby={hintId}
          aria-invalid={error !== null || isTooLong}
          className="w-full resize-y rounded-lg border border-border-strong bg-background p-3 text-base outline-none focus:border-accent focus:ring-1 focus:ring-accent aria-invalid:border-accent"
        />
        <div id={hintId} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 text-sm text-muted">
          <p className="flex items-start gap-1.5">
            <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
            Не вставляйте личные данные: текст обработает внешний сервис ИИ.
          </p>
          <p className={`tabular-nums ${isTooLong ? "font-medium text-foreground" : ""}`}>
            {source.length.toLocaleString("ru-RU")} / {MAX_SOURCE_LENGTH.toLocaleString("ru-RU")}
          </p>
        </div>
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
        >
          Построить путешествие
        </button>
        {/* Нейтральное оформление: красный и янтарный закреплены за итогами */}
        {error && (
          <p
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="flex items-start gap-1.5 rounded-lg border border-border bg-surface p-3 text-sm outline-none"
          >
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
            {error}
          </p>
        )}
      </form>

      {IS_DEV && (
        <div className="space-y-2 rounded-lg border border-dashed border-border-strong p-3 text-sm">
          <p className="text-muted">Только при разработке: примеры без запросов к модели</p>
          <div className="flex flex-wrap gap-2">
            {DEV_FIXTURES.map((fixture) => (
              <button
                key={fixture.id}
                type="button"
                onClick={() => void run((signal) => loadFixtureJourney(fixture.id, signal))}
                className="rounded-md border border-border-strong bg-background px-3 py-1.5 hover:bg-border"
              >
                {fixture.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Экран ожидания: сколько прошло времени и кнопка отмены
function Generating({ startedAt, onCancel }: { startedAt: number; onCancel: () => void }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Кнопка «Построить» исчезла — фокус на «Отменить»
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface p-5" aria-busy="true">
      <p role="status" className="flex items-center gap-2 font-semibold">
        <LoaderCircle size={20} aria-hidden="true" className="motion-safe:animate-spin text-accent" />
        Составляю путешествие…
      </p>
      <p className="text-sm text-muted">
        Сначала план, потом упражнения для каждого чекпоинта. Обычно это занимает до минуты.
        Прошло: <span className="tabular-nums">{formatTime((now - startedAt) / 1000)}</span>
      </p>
      <button
        ref={cancelRef}
        type="button"
        onClick={onCancel}
        className="rounded-md border border-border-strong bg-background px-3 py-1.5 text-sm font-medium hover:bg-border"
      >
        Отменить
      </button>
    </div>
  );
}
