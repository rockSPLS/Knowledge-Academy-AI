import { journeyResult } from "@/components/journey/results";
import type { SavedJourney } from "@/components/journey/saved";
import { latestAnswers } from "@/components/progress/summary";
import { topicStatus } from "@/lib/progress/mastery";
import type { ArticleTopics, ProgressData } from "@/lib/progress/types";

// Что стоит повторить — без модели: темы статей и понятия путешествий с итогом
// «Стоит повторить» по тому же правилу, что страница прогресса (lib/progress/mastery.ts).
// Этот список блок «Разбор ошибок» показывает, когда разбора нет (ИИ недоступен,
// ответил не по схеме, лимит, нет связи); пустой список — ошибок нет.

export type ToReviewItem = {
  kind: "topic" | "journey";
  // «Статья › Раздел» или «название путешествия» › понятие
  path: string[];
  href: string;
};

export function toReviewList(data: ProgressData, journeys: SavedJourney[], articles: ArticleTopics): ToReviewItem[] {
  const latest = latestAnswers(data.answers);
  const topics = articles
    .flatMap((article) => article.topics)
    .filter((topic) => topicStatus(topic.exerciseIds.map((id) => latest.get(id)?.verdict ?? null)) === "review")
    .map(
      (topic): ToReviewItem => ({
        kind: "topic",
        path: topic.path,
        href: `/articles/${topic.articleSlug}${topic.sectionId ? `#${topic.sectionId}` : ""}`,
      }),
    );
  // Понятия — от новых путешествий к старым, как в сводке
  const concepts = [...journeys]
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((journey) =>
      journeyResult(journey.progress)
        .checkpoints.filter((checkpoint) => checkpoint.status === "review")
        .map(
          (checkpoint): ToReviewItem => ({
            kind: "journey",
            path: [`«${journey.progress.journey.title}»`, checkpoint.concept],
            href: `/journey?id=${encodeURIComponent(journey.id)}`,
          }),
        ),
    );
  return [...topics, ...concepts];
}
