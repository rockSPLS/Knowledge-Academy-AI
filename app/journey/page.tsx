import { Suspense } from "react";
import type { Metadata } from "next";
import { JourneyPage } from "@/components/journey/JourneyPage";
import type { PortalTopicOption } from "@/components/journey/portalTopics";
import { getAllTopics } from "@/lib/progress/topics";
import { topicTitle } from "@/lib/review/topicTitles";

export const metadata: Metadata = {
  title: "Путешествие",
  description:
    "Введите тему или вставьте текст — ИИ составит маршрут из чекпоинтов с конспектами и упражнениями на время.",
};

// Страница путешествий по знаниям. Всё прохождение интерактивное и хранится
// в браузере, поэтому страница — оболочка для клиентского компонента. Какое путешествие
// открыть, компонент читает из адреса (?id=…) — это знает только браузер, поэтому
// он внутри Suspense: остальная страница собирается заранее.
// Темы статей с понятными названиями — для кнопок «Стоит повторить» в форме: какие из них
// стоит повторить, браузер считает по своему прогрессу (components/journey/portalTopics.ts)
export default function JourneyRoute() {
  const topics: PortalTopicOption[] = getAllTopics().map((topic) => ({
    key: topic.key,
    name: topicTitle(topic.articleSlug, topic.sectionId, topic.path),
    exerciseIds: topic.exerciseIds,
  }));
  return (
    <Suspense fallback={<div className="min-h-64" aria-busy="true" />}>
      <JourneyPage topics={topics} />
    </Suspense>
  );
}
