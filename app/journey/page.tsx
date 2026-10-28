import { Suspense } from "react";
import type { Metadata } from "next";
import { JourneyPage } from "@/components/journey/JourneyPage";

export const metadata: Metadata = {
  title: "Путешествие",
  description:
    "Введите тему или вставьте текст — ИИ составит маршрут из чекпоинтов с конспектами и упражнениями на время.",
};

// Страница путешествий по знаниям. Всё прохождение интерактивное и хранится
// в браузере, поэтому страница — оболочка для клиентского компонента. Какое путешествие
// открыть, компонент читает из адреса (?id=…) — это знает только браузер, поэтому
// он внутри Suspense: остальная страница собирается заранее
export default function JourneyRoute() {
  return (
    <Suspense fallback={<div className="min-h-64" aria-busy="true" />}>
      <JourneyPage />
    </Suspense>
  );
}
