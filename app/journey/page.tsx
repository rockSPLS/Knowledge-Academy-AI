import type { Metadata } from "next";
import { JourneyApp } from "@/components/journey/JourneyApp";

export const metadata: Metadata = {
  title: "Путешествие",
  description:
    "Введите тему или вставьте текст — ИИ составит маршрут из чекпоинтов с конспектами и упражнениями на время.",
};

// Страница путешествия по знаниям. Всё прохождение интерактивное и хранится
// в браузере, поэтому страница — оболочка для клиентского компонента
export default function JourneyPage() {
  return <JourneyApp />;
}
