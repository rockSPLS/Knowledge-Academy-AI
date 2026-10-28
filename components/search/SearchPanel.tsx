"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { LoaderCircle, Search, TriangleAlert, X } from "lucide-react";
import { MAX_QUESTION_LENGTH } from "@/lib/llm/limits";
import type { SearchResponse, SearchSource } from "@/lib/search/types";
import { useSearch, WIDE_QUERY } from "./SearchProvider";

// Боковая панель поиска по материалам. Устройство и поведение на широком и узком
// экране — в SearchProvider.tsx. Текст ответа модели и фрагментов выводится только
// как текст; номера [N] превращаются в ссылки на источники кодом, а не разметкой из ответа.

// Только при разработке: сохранённые ответы поиска (POST /api/search/dev) —
// панель можно проверять без запросов к модели
const DEV_FIXTURES = [
  { id: "hallucination", label: "Ответ с источниками" },
  { id: "not-in-materials", label: "В материалах нет" },
  { id: "words-only", label: "Без модели" },
  { id: "nothing-found", label: "Ничего не нашлось" },
];
const IS_DEV = process.env.NODE_ENV === "development";

export function SearchPanel() {
  const { isOpen, close, question, setQuestion, status, submit, loadFixture } = useSearch();
  const inputRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const inputId = useId();

  // При открытии — фокус в поле вопроса
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // Переход к источнику: на узком экране панель закрывается и открывает раздел,
  // на широком остаётся открытой рядом со статьёй
  function onSourceClick() {
    if (!window.matchMedia(WIDE_QUERY).matches) close(false);
  }

  return (
    <aside
      id="search-panel"
      aria-labelledby={headingId}
      hidden={!isOpen}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
      className="fixed inset-0 z-50 flex flex-col bg-background print:hidden lg:inset-y-0 lg:right-0 lg:left-auto lg:z-30 lg:w-[22rem] lg:border-l lg:border-border xl:w-[26rem]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id={headingId} className="font-semibold">
          Поиск по материалам
        </h2>
        <button
          type="button"
          onClick={() => close()}
          aria-label="Закрыть поиск"
          title="Закрыть поиск"
          className="rounded-md p-2 text-muted transition-colors hover:bg-surface hover:text-foreground"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex gap-2"
        >
          <label htmlFor={inputId} className="sr-only">
            Вопрос о материалах портала
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={MAX_QUESTION_LENGTH}
            placeholder="Например: как распознать галлюцинацию?"
            className="min-w-0 flex-1 rounded-md border border-border-strong bg-background px-3 py-2 text-sm placeholder:text-subtle focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={status.state === "loading" || !question.trim()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-fill px-3 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover disabled:opacity-60"
          >
            <Search size={16} aria-hidden="true" />
            Найти
          </button>
        </form>

        <div aria-live="polite" className="space-y-5">
          {status.state === "loading" && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle size={16} aria-hidden="true" className="animate-spin" />
              Ищем в материалах…
            </p>
          )}
          {status.state === "error" && (
            <p className="flex items-start gap-1.5 rounded-lg border border-border bg-surface p-3 text-sm">
              <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
              {status.message}
            </p>
          )}
          {status.state === "done" && <Result result={status.result} onSourceClick={onSourceClick} />}
        </div>

        {IS_DEV && (
          <div className="space-y-2 rounded-lg border border-dashed border-border-strong p-3 text-sm">
            <p className="text-muted">Только при разработке: сохранённые ответы без запросов к модели</p>
            <div className="flex flex-wrap gap-2">
              {DEV_FIXTURES.map((fixture) => (
                <button
                  key={fixture.id}
                  type="button"
                  onClick={() => loadFixture(fixture.id)}
                  className="rounded-md border border-border-strong bg-background px-3 py-1.5 hover:bg-border"
                >
                  {fixture.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function Result({ result, onSourceClick }: { result: SearchResponse; onSourceClick: () => void }) {
  if (result.sources.length === 0) {
    return <p className="text-sm">В материалах портала об этом ничего не нашлось.</p>;
  }
  return (
    <>
      {result.answer ? (
        <div className="space-y-2">
          {result.answer.text.split(/\n+/).map((paragraph, i) => (
            <p key={i} className="leading-7">
              <AnswerText text={paragraph} sources={result.sources} onSourceClick={onSourceClick} />
            </p>
          ))}
          {/* В материалах ответа нет — источников, на которые ответ опирается, тоже нет */}
          <p className="text-xs text-subtle">
            {result.notInMaterials
              ? "Ответ составлен ИИ."
              : "Ответ составлен ИИ по материалам портала. Сверяйтесь с источниками."}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {result.mode === "words"
            ? "Ответ ИИ сейчас недоступен. Вот что нашлось в материалах по словам."
            : "Ответ ИИ сейчас недоступен. Вот что нашлось в материалах."}
        </p>
      )}

      <section aria-labelledby="search-sources" className="space-y-3">
        {/* Модель сказала, что в материалах ответа нет: фрагменты — не источники ответа,
            а просто то, что нашёл поиск, и они могут быть далеки от вопроса */}
        <h3 id="search-sources" className="text-sm font-semibold">
          {result.notInMaterials ? "Что нашёл поиск" : "Источники"}
        </h3>
        <ol className="space-y-3">
          {result.sources.map((source) => (
            <SourceItem key={source.number} source={source} onSourceClick={onSourceClick} />
          ))}
        </ol>
      </section>
    </>
  );
}

// Текст ответа: «[2]» становится ссылкой на раздел источника 2. Остальное — обычный текст
function AnswerText({
  text,
  sources,
  onSourceClick,
}: {
  text: string;
  sources: SearchSource[];
  onSourceClick: () => void;
}) {
  return text.split(/(\[\d+\])/).map((part, i) => {
    const source = /^\[(\d+)\]$/.test(part) ? sources[Number(part.slice(1, -1)) - 1] : undefined;
    if (!source) return part;
    return (
      <Link
        key={i}
        href={source.href}
        onClick={onSourceClick}
        aria-label={`Источник ${source.number}: ${source.path.join(" › ")}`}
        className="mx-0.5 align-super text-xs font-medium text-accent hover:text-accent-hover"
      >
        [{source.number}]
      </Link>
    );
  });
}

function SourceItem({ source, onSourceClick }: { source: SearchSource; onSourceClick: () => void }) {
  return (
    <li className="flex gap-2 text-sm">
      <span className="w-5 shrink-0 text-subtle">{source.number}.</span>
      <div className="min-w-0 space-y-1">
        {source.kind === "exercise" ? (
          <>
            <p className="text-muted">{source.path.join(" › ")}</p>
            <p>
              <span className="mr-2 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent-soft-foreground">
                Упражнение
              </span>
              {source.snippet}
            </p>
            <p className="text-xs text-subtle">Объяснение откроется, когда вы ответите на этот вопрос</p>
            <Link
              href={source.href}
              onClick={onSourceClick}
              aria-label={`К разделу: ${source.path.join(" › ")}`}
              className="inline-block text-accent underline underline-offset-4 hover:text-accent-hover"
            >
              К разделу
            </Link>
          </>
        ) : (
          <>
            <Link
              href={source.href}
              onClick={onSourceClick}
              className="font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
            >
              {source.path.join(" › ")}
            </Link>
            <p className="text-muted">{source.snippet}</p>
          </>
        )}
      </div>
    </li>
  );
}
