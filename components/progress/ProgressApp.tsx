"use client";

import { useRef } from "react";
import Link from "next/link";
import { journeyResult, type JourneyResult } from "@/components/journey/results";
import { journeyHref, journeyStatusText } from "@/components/journey/SavedJourneys";
import { clearSavedJourneys, type SavedJourney } from "@/components/journey/saved";
import { ReviewBlock } from "@/components/review/ReviewBlock";
import { clearSavedReview } from "@/components/review/storage";
import { STORAGE_KEY as SEARCH_STORAGE_KEY } from "@/components/search/SearchProvider";
import type { Verdict } from "@/lib/exercises/types";
import { plural } from "@/lib/plural";
import { formatDate, formatDuration } from "@/lib/progress/format";
import { topicStatus, TOPIC_STATUS_LABELS, type TopicStatus } from "@/lib/progress/mastery";
import type { AnswerRecord, ArticleTopic, ArticleTopics, ProgressData } from "@/lib/progress/types";
import { ConfirmDelete, useConfirmDelete } from "./ConfirmDelete";
import { useProgressData, useSavedJourneys } from "./hooks";
import { latestAnswers } from "./summary";
import { clearProgressData } from "./store";

// Страница «Мой прогресс»: сверху четыре карточки (лучший результат теста, время
// на статьях, путешествия, сколько тем стоит повторить), под ними «Разбор ошибок»
// (components/review/ReviewBlock.tsx), затем темы статей по разделам,
// путешествия и «Ваши данные» — что хранится, что уходит модели и удаление всего.
// Всё считается из прогресса в браузере каждый раз заново: правило «усвоено / стоит
// повторить» — одно на весь портал (lib/progress/mastery.ts).

const SECTION_HEADING = "text-xl font-semibold";

export function ProgressApp({ articles }: { articles: ArticleTopics }) {
  const data = useProgressData();
  const journeys = useSavedJourneys();
  const headingRef = useRef<HTMLHeadingElement>(null);

  if (data === undefined || journeys === undefined) return <div className="min-h-64" aria-busy="true" />;

  const latest = latestAnswers(data.answers);
  const isEmpty =
    data.answers.length === 0 &&
    data.tests.length === 0 &&
    journeys.length === 0 &&
    !Object.values(data.articleSeconds).some((seconds) => seconds >= 1);

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-semibold outline-none">
          Мой прогресс
        </h1>
        <p className="text-muted">Хранится только в этом браузере.</p>
      </div>

      {isEmpty ? (
        <p className="rounded-xl border border-border bg-surface p-5">
          Пока пусто. Ответьте на упражнение в статье, пройдите тест или путешествие — здесь появятся темы и время.
        </p>
      ) : (
        <>
          <SummaryCards data={data} journeys={journeys} articles={articles} latest={latest} />
          <ReviewBlock
            articles={articles}
            intro="ИИ разберёт ваши ошибки в упражнениях, тесте и путешествиях и скажет, что повторить, — со ссылками на разделы статей."
          />
          <ArticleTopicsSection data={data} articles={articles} latest={latest} />
          <JourneysSection journeys={journeys} />
        </>
      )}

      <YourData canDelete={!isEmpty} onDeleted={() => headingRef.current?.focus()} />
    </div>
  );
}

// ---------- Карточки ----------

function statusOf(topic: ArticleTopic, latest: Map<string, AnswerRecord>): TopicStatus {
  return topicStatus(topic.exerciseIds.map((id) => latest.get(id)?.verdict ?? null));
}

// Балл теста — как в итогах теста: вниз до десятых, чтобы неидеальный не выглядел максимальным
function formatScore(score: number): string {
  return (Math.floor(score * 10) / 10).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function SummaryCards({
  data,
  journeys,
  articles,
  latest,
}: {
  data: ProgressData;
  journeys: SavedJourney[];
  articles: ArticleTopics;
  latest: Map<string, AnswerRecord>;
}) {
  // Лучшая попытка; при равном счёте — более быстрая
  const best = [...data.tests].sort((a, b) => b.score - a.score || a.seconds - b.seconds)[0];
  const articleSeconds = Object.values(data.articleSeconds).reduce((sum, seconds) => sum + seconds, 0);
  const results = journeys.map((journey) => journeyResult(journey.progress));
  const finished = results.filter((result) => result.finished).length;
  const toReview =
    articles.flatMap((article) => article.topics).filter((topic) => statusOf(topic, latest) === "review").length +
    results.flatMap((result) => result.checkpoints).filter((checkpoint) => checkpoint.status === "review").length;

  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card
        label="Тест, лучший результат"
        value={best ? `${formatScore(best.score)} из ${best.total}` : "—"}
        note={
          best
            ? `${data.tests.length} ${plural(data.tests.length, ["попытка", "попытки", "попыток"])} · ${formatDuration(best.seconds)}`
            : "Тест ещё не пройден"
        }
      />
      <Card label="Время на статьях" value={formatDuration(articleSeconds)} />
      <Card
        label="Путешествия"
        value={String(journeys.length)}
        note={`${finished} пройдено · ${journeys.length - finished} в пути`}
      />
      <Card label="Стоит повторить" value={`${toReview} ${plural(toReview, ["тема", "темы", "тем"])}`} />
    </ul>
  );
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <li className="space-y-1 rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-subtle">{note}</p>}
    </li>
  );
}

// ---------- Темы статей ----------

const STATUS_TAG: Record<TopicStatus, string> = {
  mastered: "border-success-border bg-success-soft text-success",
  review: "border-warning-border bg-warning-soft text-warning",
  "not-started": "border-border bg-background text-muted",
};

export function StatusTag({ status }: { status: TopicStatus }) {
  return (
    <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-xs font-medium ${STATUS_TAG[status]}`}>
      {TOPIC_STATUS_LABELS[status]}
    </span>
  );
}

const LAST_WRONG: Record<Exclude<Verdict, "correct">, string> = {
  partial: "последний ответ частично верный",
  incorrect: "последний ответ неверный",
};

// «верно 2 из 3» — по всем ответам на упражнения темы; если последний ответ не верный —
// так и сказано: ярлык темы — по последнему ответу
function topicNote(topic: ArticleTopic, answers: AnswerRecord[], latest: Map<string, AnswerRecord>): string {
  const own = answers.filter((record) => topic.exerciseIds.includes(record.exerciseId));
  if (own.length === 0) return "ответов пока нет";
  const wrong = topic.exerciseIds.map((id) => latest.get(id)?.verdict).find((verdict) => verdict && verdict !== "correct");
  if (wrong && wrong !== "correct") return LAST_WRONG[wrong];
  return `верно ${own.filter((record) => record.verdict === "correct").length} из ${own.length}`;
}

function ArticleTopicsSection({
  data,
  articles,
  latest,
}: {
  data: ProgressData;
  articles: ArticleTopics;
  latest: Map<string, AnswerRecord>;
}) {
  return (
    <section aria-labelledby="progress-articles" className="space-y-4">
      <h2 id="progress-articles" className={SECTION_HEADING}>
        Темы статей
      </h2>
      <ul className="space-y-4">
        {articles.map((article) => (
          <li key={article.slug} className="space-y-2 rounded-xl border border-border p-4">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/articles/${article.slug}`} className="font-semibold hover:text-accent">
                {article.title}
              </Link>
              <span className="shrink-0 text-sm text-muted tabular-nums" title="Время на статье">
                <span className="sr-only">Время на статье: </span>
                {/* Статью ещё не открывали — прочерк, а не «0 с» */}
                {(data.articleSeconds[article.slug] ?? 0) >= 1 ? formatDuration(data.articleSeconds[article.slug]) : "—"}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {article.topics.map((topic) => {
                const status = statusOf(topic, latest);
                return (
                  <li key={topic.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
                    <div className="min-w-0">
                      <p>{topic.path[1] ?? topic.path[0]}</p>
                      <p className="text-xs text-subtle">{topicNote(topic, data.answers, latest)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      {status === "review" && (
                        <Link
                          href={`/articles/${topic.articleSlug}${topic.sectionId ? `#${topic.sectionId}` : ""}`}
                          aria-label={`К разделу: ${topic.path.join(" › ")}`}
                          className="text-accent underline underline-offset-4 hover:text-accent-hover"
                        >
                          К разделу
                        </Link>
                      )}
                      <StatusTag status={status} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Путешествия ----------

function JourneysSection({ journeys }: { journeys: SavedJourney[] }) {
  return (
    <section aria-labelledby="progress-journeys" className="space-y-4">
      <h2 id="progress-journeys" className={SECTION_HEADING}>
        Путешествия
      </h2>
      {journeys.length === 0 ? (
        <p className="text-sm text-muted">
          Путешествий пока нет. <Link href="/journey" className="text-accent underline underline-offset-4 hover:text-accent-hover">Составить первое</Link>
        </p>
      ) : (
        <ul className="space-y-3">
          {journeys.map((journey) => (
            <JourneyItem key={journey.id} journey={journey} result={journeyResult(journey.progress)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function JourneyItem({ journey, result }: { journey: SavedJourney; result: JourneyResult }) {
  const { title } = journey.progress.journey;
  const review = result.checkpoints.filter((checkpoint) => checkpoint.status === "review");
  return (
    <li className="space-y-2 rounded-xl border border-border p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-base font-medium">{title}</p>
          <p className="text-muted">
            {formatDate(journey.createdAt)} · {formatDuration(result.seconds)} · {journeyStatusText(journey)}
          </p>
        </div>
        <Link
          href={journeyHref(journey.id)}
          aria-label={`${result.finished ? "Отчёт" : "Продолжить"}: ${title}`}
          className="shrink-0 rounded-md bg-accent-fill px-3 py-1.5 font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
        >
          {result.finished ? "Отчёт" : "Продолжить"}
        </Link>
      </div>
      {/* У начатого тоже: карточка «Стоит повторить» считает понятия всех путешествий */}
      {review.length > 0 && (
        <p>
          <span className="font-medium">Стоит повторить: </span>
          {review.map((checkpoint) => checkpoint.concept).join(", ")}
        </p>
      )}
    </li>
  );
}

// ---------- Ваши данные ----------

function YourData({ canDelete, onDeleted }: { canDelete: boolean; onDeleted: () => void }) {
  const { isConfirming, triggerRef, open, cancel, close } = useConfirmDelete();

  function deleteAll() {
    clearProgressData();
    clearSavedJourneys();
    // Сохранённые ответ поиска и разбор ошибок опирались на прогресс — тоже удаляются
    try {
      sessionStorage.removeItem(SEARCH_STORAGE_KEY);
    } catch {
      // Хранилище недоступно — удалять нечего
    }
    clearSavedReview();
    close();
    onDeleted();
  }

  return (
    <section aria-labelledby="progress-data" className="space-y-3">
      <h2 id="progress-data" className={SECTION_HEADING}>
        Ваши данные
      </h2>
      <p className="text-sm text-muted">
        Хранится: ответы на упражнения и тест (итог, балл, дата, тема, выбранный вариант), время на статьях и в тесте,
        путешествия.
      </p>
      <p className="text-sm text-muted">
        Модели уходит только короткая сводка: какие темы усвоены, какие стоит повторить, и несколько последних ошибок
        с вашими ответами. Чтобы поиск и разбор ошибок учитывали ваши путешествия, вместе с запросом уходят их
        названия, понятия и конспекты. Разбору ошибок уходят ещё упражнения путешествий, где были ошибки: вопрос,
        ваш ответ, в том числе своими словами, и оценка ИИ. Время и даты не уходят.
      </p>
      {canDelete &&
        (isConfirming ? (
          <ConfirmDelete
            message="Удалить весь прогресс? Удалятся ответы, время и все сохранённые путешествия. Отменить нельзя."
            onConfirm={deleteAll}
            onCancel={cancel}
          />
        ) : (
          <button
            ref={triggerRef}
            type="button"
            onClick={open}
            className="rounded-md border border-border-strong bg-background px-3 py-1.5 text-sm font-medium hover:bg-border"
          >
            Удалить весь прогресс
          </button>
        ))}
    </section>
  );
}
