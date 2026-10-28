import { setJourneyVectors } from "@/components/journey/saved";
import type { SearchResponse } from "@/lib/search/types";
import { searchContext } from "./context";

// Запросы панели поиска к серверу. Вместе с вопросом уходят сводка прогресса
// и сохранённые путешествия (context.ts); векторы путешествий, которые посчитал сервер,
// сохраняются вместе с путешествиями. Ошибка превращается в SearchApiError с текстом,
// который можно показать (поле error ответа API).

export class SearchApiError extends Error {}

// Эмбеддинг вопроса и ответ модели — до 35 секунд на сервере, ждём с запасом
const SEARCH_TIMEOUT_MS = 60_000;

async function postSearch(url: string, body: Record<string, unknown>, question: string): Promise<SearchResponse> {
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...searchContext(question) }),
      signal,
    });
  } catch {
    if (signal.aborted) throw new SearchApiError("Сервер слишком долго не отвечает. Попробуйте ещё раз.");
    throw new SearchApiError("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (typeof data?.error === "string") throw new SearchApiError(data.error);
    // 429 без нашего текста — ответил лимит на хостинге, а не наш сервер
    if (response.status === 429) {
      throw new SearchApiError("Слишком много запросов. Попробуйте снова через несколько минут.");
    }
    throw new SearchApiError("Что-то пошло не так. Попробуйте ещё раз.");
  }
  const result = data as SearchResponse;
  if (result.journeyVectors) setJourneyVectors(result.journeyVectors);
  return result;
}

export function searchMaterials(question: string): Promise<SearchResponse> {
  return postSearch("/api/search", { question }, question);
}

// Только при разработке: сохранённый ответ поиска, без запросов к модели
export function loadFixtureSearch(fixture: string): Promise<SearchResponse> {
  return postSearch("/api/search/dev", { fixture }, "");
}
