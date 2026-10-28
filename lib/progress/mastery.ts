import type { Verdict } from "@/lib/exercises/types";

// Тема усвоена или её стоит повторить — одно правило для страницы прогресса,
// сводки для модели и ярлыков в поиске. Файл без server-only: правилом пользуются
// и браузер (темы путешествий, страница прогресса), и сервер поиска (темы статей).
//
// По последнему ответу на каждое упражнение темы: все верные — «Усвоено»,
// хоть один неверный или частичный — «Стоит повторить», ответов нет — «Не начато».
// Исправленная ошибка сразу засчитывается: важен последний ответ, а не доля верных.
// Тема статьи — раздел, тема путешествия — понятие чекпоинта.

export type TopicStatus = "mastered" | "review" | "not-started";

// verdicts — последний итог по каждому упражнению темы; null — на упражнение не отвечали
export function topicStatus(verdicts: (Verdict | null)[]): TopicStatus {
  if (verdicts.some((verdict) => verdict === "partial" || verdict === "incorrect")) return "review";
  if (verdicts.length > 0 && verdicts.every((verdict) => verdict === "correct")) return "mastered";
  return "not-started";
}

export const TOPIC_STATUS_LABELS: Record<TopicStatus, string> = {
  mastered: "Усвоено",
  review: "Стоит повторить",
  "not-started": "Не начато",
};
