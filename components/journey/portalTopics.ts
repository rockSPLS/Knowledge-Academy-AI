import { latestAnswers } from "@/components/progress/summary";
import { topicStatus } from "@/lib/progress/mastery";
import type { ProgressData } from "@/lib/progress/types";

// Кнопки «Стоит повторить» в форме путешествия по материалам портала: темы статей, которые
// человеку стоит повторить, по тому же правилу, что страница прогресса (lib/progress/mastery.ts).
// Понятные названия тем — те же, что в разборе ошибок (lib/review/topicTitles.ts): их считает
// сервер страницы и передаёт сюда вместе с упражнениями тем. Понятия путешествий сюда не идут:
// путешествие по материалам портала собирается из разделов статей.

export type PortalTopicOption = { key: string; name: string; exerciseIds: string[] };

// Сколько кнопок тем показывать
export const MAX_TOPIC_BUTTONS = 5;

// Названия тем, от последней ошибки к более ранним
export function topicsToRepeat(data: ProgressData, topics: PortalTopicOption[]): string[] {
  const latest = latestAnswers(data.answers);
  return topics
    .filter((topic) => topicStatus(topic.exerciseIds.map((id) => latest.get(id)?.verdict ?? null)) === "review")
    .map((topic) => ({
      name: topic.name,
      // Когда была последняя ошибка в упражнениях темы
      at: Math.max(
        ...topic.exerciseIds.map((id) => {
          const record = latest.get(id);
          return record && record.verdict !== "correct" ? record.at : 0;
        }),
      ),
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_TOPIC_BUTTONS)
    .map((topic) => topic.name);
}
