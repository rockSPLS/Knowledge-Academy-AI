"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BackToArticles } from "@/components/layout/BackToArticles";
import { useSavedJourneys } from "@/components/progress/hooks";
import { MAX_PORTAL_TOPIC_LENGTH } from "@/lib/llm/limits";
import { JourneyApp } from "./JourneyApp";
import { JourneyForm, type JourneyArticle } from "./JourneyForm";
import type { PortalTopicOption } from "./portalTopics";
import { journeyHref, SavedJourneys } from "./SavedJourneys";
import { MAX_SAVED_JOURNEYS, newJourneyId, saveJourney } from "./saved";
import { journeyReducer } from "./state";

// Страница путешествий. /journey?id=<id> — прохождение сохранённого путешествия
// (JourneyApp.tsx); /journey — «Мои путешествия» и форма нового. Новое путешествие
// сохраняется сразу, как только создано, и открывается по своему адресу: ссылка
// из источника поиска ведёт на него же.
// /journey?topic=<тема> — форма в режиме «По материалам портала» с уже вписанной темой
// (ссылка в пунктах разбора ошибок). /journey?article=<slug> — «Путешествие по этой статье»
// (ссылка в конце статьи): тема — название статьи, а пока её не изменили, материал — разделы
// этой статьи. Путешествие само не строится: тема из адреса — только текст поля, с тем же пределом длины.

// topics — темы статей с понятными названиями для кнопок «Стоит повторить» в форме
// articles — статьи портала (slug и название) для ?article=…
export function JourneyPage({ topics, articles }: { topics: PortalTopicOption[]; articles: JourneyArticle[] }) {
  const params = useSearchParams();
  const id = params.get("id");
  // Статьи с таким slug нет — как будто адрес без статьи
  const article = articles.find((item) => item.slug === params.get("article"));
  const topic = (article?.title ?? params.get("topic"))?.trim().slice(0, MAX_PORTAL_TOPIC_LENGTH) || undefined;
  // key — другое путешествие открывается с чистым состоянием
  return id ? (
    <JourneyApp key={id} journeyId={id} />
  ) : (
    <JourneyHome topics={topics} initialTopic={topic} article={article} />
  );
}

function JourneyHome({
  topics,
  initialTopic,
  article,
}: {
  topics: PortalTopicOption[];
  initialTopic?: string;
  article?: JourneyArticle;
}) {
  const router = useRouter();
  const journeys = useSavedJourneys();
  const [saveError, setSaveError] = useState(false);
  const formHeadingRef = useRef<HTMLHeadingElement>(null);

  if (journeys === undefined) return <div className="min-h-64" aria-busy="true" />;
  const isFull = journeys.length >= MAX_SAVED_JOURNEYS;

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <BackToArticles />
        <h1 className="text-3xl font-semibold">Путешествие по знаниям</h1>
        <p className="text-lg text-muted">
          Выберите тему из материалов портала, введите свою или вставьте текст — ИИ составит маршрут
          из нескольких чекпоинтов. В каждом — короткий конспект одного понятия и упражнения на время:
          от простого к сложному.
        </p>
      </div>
      <SavedJourneys journeys={journeys} onRemovedLast={() => formHeadingRef.current?.focus()} />
      {isFull ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">
          Сохранено {MAX_SAVED_JOURNEYS} путешествий — это предел. Удалите старые, чтобы начать новое.
        </p>
      ) : (
        <section aria-labelledby="new-journey-heading" className="space-y-3">
          {/* Заголовок формы — только когда над ней есть список: иначе форма и так одна на странице */}
          <h2
            ref={formHeadingRef}
            id="new-journey-heading"
            tabIndex={-1}
            className={journeys.length > 0 ? "text-xl font-semibold outline-none" : "sr-only"}
          >
            Новое путешествие
          </h2>
          {saveError && (
            <p role="alert" className="text-sm">
              Путешествие составлено, но не сохранилось: хранилище браузера недоступно или переполнено.
            </p>
          )}
          {/* key — другая тема из адреса вписывается в чистую форму */}
          <JourneyForm
            key={`${article?.slug ?? ""}:${initialTopic ?? ""}`}
            topics={topics}
            initialTopic={initialTopic}
            article={article}
            onCreated={(generated) => {
              const id = newJourneyId();
              const progress = journeyReducer(undefined, { type: "create", ...generated });
              if (!progress || !saveJourney({ id, createdAt: Date.now(), progress })) {
                setSaveError(true);
                return;
              }
              router.push(journeyHref(id));
            }}
          />
        </section>
      )}
    </div>
  );
}
