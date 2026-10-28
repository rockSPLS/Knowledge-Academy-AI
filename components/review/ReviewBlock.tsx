"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ScrollLink } from "@/components/layout/ScrollLink";
import { ChevronDown, LoaderCircle, TriangleAlert } from "lucide-react";
import { useHydrated, useProgressData, useSavedJourneys } from "@/components/progress/hooks";
import { buildProgressSummary, isEmptySummary } from "@/components/progress/summary";
import { KIND_TAG } from "@/components/search/SearchPanel";
import { plural } from "@/lib/plural";
import type { ArticleTopics } from "@/lib/progress/types";
import type { Review, ReviewFailure, ReviewResponse, ReviewSource } from "@/lib/review/types";
import { loadFixtureReview, requestReview, ReviewApiError, type ReviewInput } from "./api";
import {
  collapsedSnapshot,
  isSameSummary,
  reviewSnapshot,
  saveCollapsed,
  saveReview,
  serverCollapsedSnapshot,
  serverReviewSnapshot,
  subscribeReview,
} from "./storage";
import { toReviewList, type ToReviewItem } from "./toReview";

// Блок «Разбор ошибок» — на странице прогресса (под карточками) и в итогах теста.
// Разбор один и тот же — по всему прогрессу; его составляет ИИ по кнопке (POST /api/review).
// - Нет прогресса или ошибок — запроса нет, блок так и пишет.
// - Разбор хранится в sessionStorage вместе со сводкой (storage.ts): перезагрузка не тратит
//   запрос, а после новых ответов рядом с разбором — «Разобрать заново».
// - Разбора нет (ИИ недоступен, ответил не по схеме, лимит, нет связи) — блок так и говорит
//   и показывает, что стоит повторить, по правилу страницы прогресса (toReview.ts).
// - Пока ждём ответа, кнопка неактивна (aria-disabled: фокус остаётся на ней); уход со страницы
//   отменяет запрос. Готов разбор — фокус на его начало, разбора нет — на сообщение.
// - Заголовок — кнопка, которая сворачивает и разворачивает блок (aria-expanded). Сразу после
//   разбора блок развёрнут, свёрнутый остаётся свёрнутым до закрытия вкладки (storage.ts).
// - Об ИИ сказано один раз: подзаголовок-приглашение — только до разбора, после — ярлык
//   «Составлено ИИ» у вывода и внизу «Сверяйтесь с источниками.».
// Ссылки пунктов строит сервер по проверенным номерам фрагментов, текст ИИ выводится как текст.

// Только при разработке: сохранённые разборы (POST /api/review/dev) — блок можно проверять
// без запросов к модели
const DEV_FIXTURES = [
  { id: "articles", label: "Ошибки в статьях и тесте" },
  { id: "journeys", label: "С путешествием" },
  { id: "bad-numbers", label: "Чужие номера" },
  { id: "no-sources", label: "Без источников" },
  { id: "unavailable", label: "Без модели" },
  { id: "invalid", label: "Не по схеме" },
];
const IS_DEV = process.env.NODE_ENV === "development";

const FAILURE_TEXT: Record<ReviewFailure, string> = {
  "not-configured": "ИИ сейчас недоступен, поэтому разбора нет.",
  unavailable: "ИИ сейчас недоступен, поэтому разбора нет.",
  "invalid-output": "ИИ ответил с ошибкой, поэтому разбора нет. Попробуйте ещё раз.",
};

const NO_PROGRESS_TEXT = "Разбирать пока нечего. Ответьте на упражнения в статьях, пройдите тест или путешествие.";
const NO_MISTAKES_TEXT = "Ошибок нет: последние ответы верные.";

const BUTTON =
  "rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover aria-disabled:opacity-60";

// withList — показать под сообщением, что стоит повторить: не нужно, если сервер ответил,
// что прогресса или ошибок нет
type RequestState = { kind: "idle" } | { kind: "loading" } | { kind: "failed"; message: string; withList: boolean };

// linkToProgress — в итогах теста: если в разбор вошли не все темы, ссылка на «Мой прогресс»,
// где видны все. На странице прогресса темы и так ниже
export function ReviewBlock({
  articles,
  intro,
  linkToProgress = false,
}: {
  articles: ArticleTopics;
  intro: string;
  linkToProgress?: boolean;
}) {
  const data = useProgressData();
  const journeys = useSavedJourneys();
  const hydrated = useHydrated();
  const stored = useSyncExternalStore(subscribeReview, reviewSnapshot, serverReviewSnapshot);
  const saved = hydrated ? stored : null;
  const collapsed = useSyncExternalStore(subscribeReview, collapsedSnapshot, serverCollapsedSnapshot);
  const [request, setRequest] = useState<RequestState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  const headingId = useId();
  const bodyId = useId();
  // Куда перевести фокус, когда ответ отрисован: кнопки «Разобрать» после разбора уже нет
  const pendingFocus = useRef<"result" | "message" | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  // Уход со страницы отменяет запрос: сервер отменит и запрос к модели
  useEffect(() => () => controller.current?.abort(), []);

  // После каждой отрисовки: если ждёт перевод фокуса и нужный блок уже на странице — фокус на него
  useEffect(() => {
    const target = pendingFocus.current === "result" ? resultRef.current : pendingFocus.current === "message" ? messageRef.current : null;
    if (!target) return;
    pendingFocus.current = null;
    target.focus();
  });

  if (data === undefined || journeys === undefined) {
    return <section aria-labelledby={headingId} aria-busy="true" className="min-h-32" />;
  }

  const summary = buildProgressSummary(data, journeys);
  const toReview = toReviewList(data, journeys, articles);
  const isStale = saved !== null && !isSameSummary(saved.summary, summary);
  const isLoading = request.kind === "loading";

  async function run(load: (input: ReviewInput, signal: AbortSignal) => Promise<ReviewResponse>) {
    if (isLoading) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    // Сводка и число тем на момент нажатия — по ним составлен разбор
    const asked = summary;
    const total = toReview.length;
    setRequest({ kind: "loading" });
    try {
      const articleCount = toReview.filter((item) => item.kind === "topic").length;
      const result = await load({ summary: asked, journeys: journeys!, articleCount }, current.signal);
      if (current.signal.aborted) return;
      if (result.status === "done") {
        pendingFocus.current = "result";
        saveReview({ summary: asked, review: result.review, total });
        setRequest({ kind: "idle" });
        return;
      }
      pendingFocus.current = "message";
      if (result.status === "failed") {
        setRequest({ kind: "failed", message: FAILURE_TEXT[result.reason], withList: true });
      } else {
        // Сервер посчитал иначе, чем браузер (подделанная или обрезанная сводка), — его слово последнее
        setRequest({
          kind: "failed",
          message: result.status === "no-progress" ? NO_PROGRESS_TEXT : NO_MISTAKES_TEXT,
          withList: false,
        });
      }
    } catch (error) {
      if (current.signal.aborted) return;
      pendingFocus.current = "message";
      setRequest({
        kind: "failed",
        message: error instanceof ReviewApiError ? error.message : "Что-то пошло не так, поэтому разбора нет. Попробуйте ещё раз.",
        withList: true,
      });
    }
  }

  let body: React.ReactNode;
  if (isEmptySummary(summary)) {
    body = <p className="text-sm">{NO_PROGRESS_TEXT}</p>;
  } else if (toReview.length === 0) {
    body = <p className="text-sm">{NO_MISTAKES_TEXT}</p>;
  } else {
    const button = (
      <button type="button" onClick={() => run(requestReview)} aria-disabled={isLoading} className={BUTTON}>
        {isLoading ? "Разбираю…" : saved ? "Разобрать заново" : "Разобрать ошибки"}
      </button>
    );
    body = (
      <>
        {!saved && button}
        {saved && isStale && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-sm text-muted">Есть новые ответы.</p>
            {button}
          </div>
        )}
        {/* Озвучивается только строка ожидания: разбор и сообщение получают фокус, их диктор прочитает сам */}
        <div aria-live="polite">
          {isLoading && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle size={16} aria-hidden="true" className="animate-spin" />
              ИИ разбирает ваши ответы…
            </p>
          )}
        </div>
        {request.kind === "failed" && (
          <Fallback focusRef={messageRef} message={request.message} items={request.withList ? toReview : []} />
        )}
        {saved && (
          <ReviewResult focusRef={resultRef} review={saved.review} total={saved.total} linkToProgress={linkToProgress} />
        )}
      </>
    );
  }

  return (
    // gap, а не space-y: у свёрнутого блока под заголовком не остаётся отступа скрытого содержимого
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xl border border-border p-5">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">
          <button
            id={headingId}
            type="button"
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            onClick={() => saveCollapsed(!collapsed)}
            className="-m-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-3 rounded-md p-1 text-left transition-colors hover:text-accent"
          >
            Разбор ошибок
            <ChevronDown
              size={20}
              aria-hidden="true"
              className={`shrink-0 text-muted transition-transform motion-reduce:transition-none ${collapsed ? "" : "rotate-180"}`}
            />
          </button>
        </h2>
        {/* Приглашение — только до разбора: над готовым разбором оно повторяло бы ярлык «Составлено ИИ» */}
        {!saved && !collapsed && <p className="text-sm text-muted">{intro}</p>}
      </div>
      <div id={bodyId} hidden={collapsed} className="space-y-4">
        {body}
        {IS_DEV && toReview.length > 0 && (
          <div className="space-y-2 rounded-lg border border-dashed border-border-strong p-3 text-sm">
            <p className="text-muted">Только при разработке: сохранённые разборы без запросов к модели</p>
            <div className="flex flex-wrap gap-2">
              {DEV_FIXTURES.map((fixture) => (
                <button
                  key={fixture.id}
                  type="button"
                  aria-disabled={isLoading}
                  onClick={() => run((input, signal) => loadFixtureReview(fixture.id, input, signal))}
                  className="rounded-md border border-border-strong bg-background px-3 py-1.5 hover:bg-border aria-disabled:opacity-60"
                >
                  {fixture.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function ReviewResult({
  review,
  total,
  linkToProgress,
  focusRef,
}: {
  review: Review;
  total: number;
  linkToProgress: boolean;
  focusRef: React.Ref<HTMLDivElement>;
}) {
  const count = review.items.length;
  return (
    <div ref={focusRef} tabIndex={-1} className="space-y-4 outline-none">
      {/* Общий вывод может быть пустым: сервер убирает вывод со сбоем модели */}
      <p>
        <span className={KIND_TAG}>Составлено ИИ</span>
        {review.summary}
      </p>
      <ol className="space-y-3">
        {review.items.map((item, i) => (
          <li key={i} className="space-y-1.5 rounded-lg border border-border bg-surface p-4 text-sm">
            <p className="font-medium">
              {i + 1}. {item.topic}
            </p>
            {item.mistake && (
              <p>
                <span className="font-medium">В чём ошибка: </span>
                {item.mistake}
              </p>
            )}
            {item.review && (
              <p>
                <span className="font-medium">Что повторить: </span>
                {item.review}
              </p>
            )}
            <ul aria-label="Источники" className="space-y-1">
              {item.sources.map((source) => (
                <SourceLink key={source.href} source={source} />
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {count < total && (
        <p className="text-sm text-muted">
          В разбор {plural(count, ["вошла", "вошли", "вошли"])} {count} из {total} {plural(total, ["темы", "тем", "тем"])}.{" "}
          {linkToProgress ? (
            <>
              Все темы, которые стоит повторить, — на странице{" "}
              <Link href="/progress" className="text-accent underline underline-offset-4 hover:text-accent-hover">
                «Мой прогресс»
              </Link>
              .
            </>
          ) : (
            "Все — ниже."
          )}
        </p>
      )}
      {/* Что разбор составлен ИИ, уже говорит ярлык у вывода */}
      <p className="text-xs text-subtle">Сверяйтесь с источниками.</p>
    </div>
  );
}

function SourceLink({ source }: { source: ReviewSource }) {
  return (
    <li>
      {source.kind === "exercise" && <span className={KIND_TAG}>Упражнение</span>}
      {source.kind === "journey" && <span className={KIND_TAG}>Путешествие</span>}
      <ScrollLink href={source.href} className="text-accent underline underline-offset-4 hover:text-accent-hover">
        {source.path.join(" › ")}
      </ScrollLink>
    </li>
  );
}

// Разбора нет — сообщение и что стоит повторить по правилу страницы прогресса, со ссылками.
// Если сервер ответил, что прогресса или ошибок нет, списка нет (items пустой)
function Fallback({
  message,
  items,
  focusRef,
}: {
  message: string;
  items: ToReviewItem[];
  focusRef: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={focusRef} tabIndex={-1} className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm outline-none">
      <p className="flex items-start gap-1.5">
        <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
        <span>
          {message} {items.length > 0 && "Что стоит повторить по вашим ответам:"}
        </span>
      </p>
      {items.length > 0 && (
        <ul className="space-y-1 pl-6">
          {items.map((item) => (
            <li key={`${item.kind}:${item.href}:${item.path.join("›")}`}>
              {item.kind === "journey" && <span className={KIND_TAG}>Путешествие</span>}
              <ScrollLink href={item.href} className="text-accent underline underline-offset-4 hover:text-accent-hover">
                {item.path.join(" › ")}
              </ScrollLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
