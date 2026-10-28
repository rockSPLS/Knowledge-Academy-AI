import type { Metadata } from "next";
import { ProgressApp } from "@/components/progress/ProgressApp";
import { getArticleTopics } from "@/lib/progress/topics";

export const metadata: Metadata = {
  title: "Мой прогресс",
  description: "Какие темы усвоены и какие стоит повторить, время на статьях, тест и путешествия.",
};

// Страница прогресса. Прогресс хранится в браузере, поэтому страница — оболочка
// для клиентского компонента. Темы статей (какой раздел проверяет каждое упражнение)
// знает индекс поиска на сервере — в браузер уходят только названия, якоря и id упражнений
export default function ProgressPage() {
  return <ProgressApp articles={getArticleTopics()} />;
}
