import type { SavedJourney } from "@/components/journey/saved";
import { toSearchInput } from "@/components/search/context";
import type { ProgressSummary } from "@/lib/progress/types";
import { MAX_REVIEW_ITEMS, type ReviewResponse } from "@/lib/review/types";
import { journeyExercisesForReview } from "./journeyExercises";

// Запрос разбора ошибок. Тело — та же сводка прогресса, что у поиска, только те
// путешествия, понятия которых могут войти в разбор (первые MAX_REVIEW_ITEMS по сводке), —
// без векторов: разбору нужен конспект чекпоинта, — и упражнения с ошибкой у понятий,
// которые войдут в разбор (journeyExercises.ts). Ошибка превращается в ReviewApiError
// с текстом, который можно показать; отмена (уход со страницы) — в AbortError.

export class ReviewApiError extends Error {}

// Эмбеддинги понятий и ответ модели — до 50 секунд на сервере, ждём с запасом
const REVIEW_TIMEOUT_MS = 70_000;

// articleCount — сколько тем статей стоит повторить: от него зависит, сколько понятий войдёт в разбор
export function reviewBody(summary: ProgressSummary, journeys: SavedJourney[], articleCount: number) {
  const ids = new Set(summary.journeyConcepts.slice(0, MAX_REVIEW_ITEMS).map((concept) => concept.journeyId));
  return {
    progress: summary,
    journeys: journeys.filter((journey) => ids.has(journey.id)).map((journey) => toSearchInput(journey, false)),
    journeyExercises: journeyExercisesForReview(summary, journeys, articleCount),
  };
}

export type ReviewInput = { summary: ProgressSummary; journeys: SavedJourney[]; articleCount: number };

async function postReview(url: string, body: Record<string, unknown>, signal: AbortSignal): Promise<ReviewResponse> {
  // Отмена — и уходом со страницы, и по тайм-ауту. Свой контроллер, а не AbortSignal.any:
  // его нет в Safari до 17.4, а сайт поддерживает и более старые браузеры
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REVIEW_TIMEOUT_MS);

  let response: Response;
  let data: { error?: unknown } | null;
  try {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // Не JSON — null; отмена или тайм-аут во время чтения — в catch ниже
      data = await response.json().catch((error: unknown) => {
        if (controller.signal.aborted) throw error;
        return null;
      });
    } catch (error) {
      if (signal.aborted) throw error;
      if (timedOut) throw new ReviewApiError("Сервер слишком долго не отвечает, поэтому разбора нет. Попробуйте ещё раз.");
      throw new ReviewApiError("Нет связи с сервером, поэтому разбора нет. Проверьте интернет и попробуйте ещё раз.");
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
  if (!response.ok) {
    if (typeof data?.error === "string") throw new ReviewApiError(data.error);
    // 429 без нашего текста — ответил лимит на хостинге, а не наш сервер
    if (response.status === 429) throw new ReviewApiError("Слишком много запросов. Попробуйте снова через несколько минут.");
    throw new ReviewApiError("Что-то пошло не так, поэтому разбора нет. Попробуйте ещё раз.");
  }
  if (!data) throw new ReviewApiError("Что-то пошло не так, поэтому разбора нет. Попробуйте ещё раз.");
  return data as ReviewResponse;
}

export function requestReview({ summary, journeys, articleCount }: ReviewInput, signal: AbortSignal) {
  return postReview("/api/review", reviewBody(summary, journeys, articleCount), signal);
}

// Только при разработке: сохранённый разбор, без запросов к модели
export function loadFixtureReview(fixture: string, { summary, journeys, articleCount }: ReviewInput, signal: AbortSignal) {
  return postReview("/api/review/dev", { fixture, ...reviewBody(summary, journeys, articleCount) }, signal);
}
