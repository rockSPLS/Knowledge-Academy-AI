import "server-only";
import { articles } from "@/lib/articles";
import indexFile from "@/lib/search/search-index.json";
import type { SearchIndexFile } from "@/lib/search/types";
import type { ArticleTopic, ArticleTopics } from "./types";

// Темы статей для прогресса: какой раздел статьи проверяет каждое упражнение банка.
// Эту связь строит индексатор поиска (lib/search/chunks.ts: упражнение стоит в статье
// сразу после своего раздела), поэтому она берётся из индекса. Индекс читается только
// на сервере — в нём объяснения упражнений; браузер получает отсюда только
// названия статей и разделов, якоря и id упражнений.

const index = indexFile as SearchIndexFile;

const topics: ArticleTopic[] = [];
for (const chunk of index.chunks) {
  if (chunk.kind !== "exercise" || !chunk.exerciseId) continue;
  const key = `${chunk.articleSlug}#${chunk.sectionId}`;
  const topic = topics.find((item) => item.key === key);
  if (topic) topic.exerciseIds.push(chunk.exerciseId);
  else topics.push({ key, articleSlug: chunk.articleSlug, sectionId: chunk.sectionId, path: chunk.path, exerciseIds: [chunk.exerciseId] });
}

// Темы по статьям, в порядке курса и разделов
export function getArticleTopics(): ArticleTopics {
  return articles.map((article) => ({
    slug: article.slug,
    title: article.title,
    topics: topics.filter((topic) => topic.articleSlug === article.slug),
  }));
}

export function getTopicOfExercise(exerciseId: string): ArticleTopic | undefined {
  return topics.find((topic) => topic.exerciseIds.includes(exerciseId));
}

export function getAllTopics(): ArticleTopic[] {
  return topics;
}
