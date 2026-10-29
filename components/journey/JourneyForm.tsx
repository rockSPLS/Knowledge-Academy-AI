"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, ShieldAlert, TriangleAlert } from "lucide-react";
import { useProgressData } from "@/components/progress/hooks";
import { useProgressForAi } from "@/components/progress/progressForAi";
import { MAX_PORTAL_TOPIC_LENGTH, MAX_SOURCE_LENGTH } from "@/lib/llm/limits";
import { formatTime } from "@/lib/journey/timing";
import {
  generateJourney,
  generatePortalJourney,
  JourneyApiError,
  loadFixtureJourney,
  type GeneratedJourney,
} from "./api";
import { topicsToRepeat, type PortalTopicOption } from "./portalTopics";

// Форма путешествия. Над полем — переключатель: «По материалам портала» (выбран сразу) —
// тема, по которой сервер соберёт путешествие из разделов статей, и кнопки тем статей,
// которые человеку стоит повторить; «Своя тема или текст» — тема или вставленный текст,
// как раньше. Пока идёт генерация, её можно отменить — запрос обрывается, и сервер
// прекращает запросы к модели (так же, как если закрыть страницу).

// Только при разработке: примеры путешествий из сохранённых ответов модели
// (POST /api/journey/dev) — экраны можно проверять без запросов к модели
const DEV_FIXTURES = [
  { id: "portal-hallucinations", label: "Галлюцинации (по материалам портала)" },
  { id: "photosynthesis", label: "Фотосинтез" },
  { id: "inflation", label: "Инфляция" },
  { id: "dough", label: "Тесто (текст со спорным утверждением)" },
  { id: "vaccines", label: "Прививки" },
];
const IS_DEV = process.env.NODE_ENV === "development";

type FormMode = "portal" | "own";

// Ответы сервера, после которых стоит предложить свою тему: в материалах портала нет
// или путешествие по ним недоступно
const OFFER_OWN_CODES = new Set(["not-in-materials", "portal-unavailable"]);

const MODES: { value: FormMode; label: string }[] = [
  { value: "portal", label: "По материалам портала" },
  { value: "own", label: "Своя тема или текст" },
];

// Статья «Путешествия по этой статье»: slug уходит на сервер, название — тема в поле
export type JourneyArticle = { slug: string; title: string };

// initialTopic — тема из адреса (/journey?topic=… или название статьи из ?article=…): вписана в поле,
// поле в фокусе, путешествие само не строится. article — пока тема в поле совпадает с названием
// статьи, материал — разделы этой статьи; тему изменили — обычный поиск по всем статьям
export function JourneyForm({
  topics,
  initialTopic,
  article,
  onCreated,
}: {
  topics: PortalTopicOption[];
  initialTopic?: string;
  article?: JourneyArticle;
  onCreated: (generated: GeneratedJourney) => void;
}) {
  const [mode, setMode] = useState<FormMode>("portal");
  const [topic, setTopic] = useState(initialTopic ?? "");
  const [source, setSource] = useState("");
  const [error, setError] = useState<{ text: string; offerOwn: boolean } | null>(null);
  const [isGenerating, setGenerating] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const fieldId = useId();
  const hintId = useId();
  const repeatId = useId();
  const topicRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const progress = useProgressData();
  // Учёт прогресса выключен — ИИ не получит темы, которые стоит повторить, и кнопок тем нет
  const withProgress = useProgressForAi();
  const toRepeat = progress && withProgress ? topicsToRepeat(progress, topics) : [];

  // Ушли со страницы во время генерации — отменяем запрос
  useEffect(() => () => controller.current?.abort(), []);

  // Тема пришла из адреса — поле в фокусе: форма под списком «Мои путешествия» прокручивается к нему
  useEffect(() => {
    if (initialTopic) topicRef.current?.focus();
  }, [initialTopic]);

  // Сообщение об ошибке — в фокус, чтобы его прочитал экранный диктор и увидела клавиатура
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const value = mode === "portal" ? topic : source;
  const limit = mode === "portal" ? MAX_PORTAL_TOPIC_LENGTH : MAX_SOURCE_LENGTH;
  const trimmed = value.trim();
  const isTooLong = value.length > limit;
  const byArticle = mode === "portal" && article !== undefined && trimmed === article.title.trim() ? article : undefined;

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
      setError({
        text: caught instanceof Error ? caught.message : "Что-то пошло не так. Попробуйте ещё раз.",
        offerOwn: caught instanceof JourneyApiError && OFFER_OWN_CODES.has(caught.code),
      });
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
      setError({ text: mode === "portal" ? "Введите тему" : "Введите тему или вставьте текст", offerOwn: false });
      return;
    }
    if (isTooLong) {
      setError({
        text:
          mode === "portal"
            ? `Тема длиннее ${MAX_PORTAL_TOPIC_LENGTH} символов — сократите её`
            : `Текст длиннее ${MAX_SOURCE_LENGTH.toLocaleString("ru-RU")} символов — сократите его`,
        offerOwn: false,
      });
      return;
    }
    void run((signal) =>
      mode === "portal" ? generatePortalJourney(trimmed, signal, byArticle?.slug) : generateJourney(trimmed, signal),
    );
  }

  function switchMode(next: FormMode) {
    setMode(next);
    setError(null);
  }

  // «Построить по своей теме» после «в материалах портала нет»: тема переходит в поле
  // своей темы, если оно пустое
  function switchToOwnTopic() {
    if (!source.trim()) setSource(topic);
    switchMode("own");
    requestAnimationFrame(() => sourceRef.current?.focus());
  }

  function chooseTopic(name: string) {
    setTopic(name);
    setError(null);
    topicRef.current?.focus();
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
        {/* Переключатель — обычные переключатели-кнопки (radio): стрелки и Tab работают сами,
            экранный диктор читает группу и выбранный вариант */}
        <fieldset>
          <legend className="sr-only">Из чего построить путешествие</legend>
          {/* На телефоне — две равные половины во всю ширину, на широком экране — по тексту */}
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border-strong bg-surface p-1 sm:inline-grid">
            {MODES.map((item) => (
              <label key={item.value} className="cursor-pointer">
                <input
                  type="radio"
                  name="journey-mode"
                  value={item.value}
                  checked={mode === item.value}
                  onChange={() => switchMode(item.value)}
                  className="peer sr-only"
                />
                <span className="block h-full rounded-md px-3 py-1.5 text-center text-sm font-medium text-muted transition-colors peer-checked:bg-accent-fill peer-checked:text-accent-fill-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-accent hover:text-foreground peer-checked:hover:text-accent-fill-foreground">
                  {item.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "portal" ? (
          <>
            <label htmlFor={fieldId} className="block font-medium">
              Тема из материалов портала
            </label>
            <input
              ref={topicRef}
              id={fieldId}
              type="text"
              value={topic}
              onChange={(event) => {
                setTopic(event.target.value);
                setError(null);
              }}
              placeholder="Например: галлюцинации или структура промпта"
              aria-describedby={hintId}
              aria-invalid={error !== null || isTooLong}
              className="w-full rounded-lg border border-border-strong bg-background p-3 text-base outline-none focus:border-accent focus:ring-1 focus:ring-accent aria-invalid:border-accent"
            />
            <div id={hintId} className="space-y-1 text-sm text-muted">
              {byArticle ? (
                <p>
                  Путешествие соберётся из разделов статьи «{byArticle.title}». Измените тему — и оно соберётся
                  из разделов всех статей.
                  {withProgress && " Темы этой статьи, которые вам стоит повторить, войдут в путешествие."}
                </p>
              ) : (
                <p>
                  Путешествие соберётся из разделов статей портала.
                  {withProgress && " Темы, которые вам стоит повторить, войдут в путешествие, если они по этой теме."}
                </p>
              )}
              <p className="flex items-start gap-1.5">
                <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
                Не вставляйте личные данные: тему обработает внешний сервис ИИ.
              </p>
            </div>
            {toRepeat.length > 0 && (
              // Группа с подписью: диктор читает «Стоит повторить», затем кнопку с названием темы
              <div role="group" aria-labelledby={repeatId} className="flex flex-wrap items-center gap-2 text-sm">
                <span id={repeatId} className="font-medium">
                  Стоит повторить:
                </span>
                {toRepeat.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => chooseTopic(name)}
                    className="rounded-md border border-border-strong bg-background px-2.5 py-1 hover:bg-border"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <label htmlFor={fieldId} className="block font-medium">
              Тема или текст
            </label>
            <textarea
              ref={sourceRef}
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
          </>
        )}
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
        >
          Построить путешествие
        </button>
        {/* Нейтральное оформление: красный и янтарный закреплены за итогами */}
        {error && (
          <div className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
            <p ref={errorRef} role="alert" tabIndex={-1} className="flex items-start gap-1.5 outline-none">
              <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
              {error.text}
            </p>
            {error.offerOwn && (
              <button
                type="button"
                onClick={switchToOwnTopic}
                className="rounded-md border border-border-strong bg-background px-3 py-1.5 font-medium hover:bg-border"
              >
                Построить по своей теме
              </button>
            )}
          </div>
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
        Сначала план, потом упражнения для каждого чекпоинта. Обычно это занимает одну-две минуты.
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
