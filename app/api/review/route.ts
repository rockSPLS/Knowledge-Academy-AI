import { MAX_SEARCH_REQUEST_BYTES } from "@/lib/llm/limits";
import { consumeReviewRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { rateLimitedResponse } from "@/lib/llm/responses";
import { reviewProgress } from "@/lib/review/review";
import type { ReviewResponse } from "@/lib/review/types";
import { parseReviewContext } from "@/lib/review/request";

// POST /api/review — разбор ошибок по прогрессу.
// Принимает { progress?, journeys?, journeyExercises? } — ту же сводку прогресса, что поиск,
// путешествия, понятия которых стоит повторить, и упражнения этих понятий с ошибкой
// (lib/review/request.ts разбирает их по одной записи).
// Возвращает ReviewResponse (lib/review/types.ts): прогресса нет, ошибок нет, разбор
// или «разбора нет» с причиной — все с кодом 200; лимит частоты — 429.

// Эмбеддинги понятий (до 10 с) и ответ модели (до 40 с)
export const maxDuration = 60;

export async function POST(request: Request) {
  const limit = consumeReviewRequest(request);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);

  const body = await readJsonBody(request, MAX_SEARCH_REQUEST_BYTES);
  if (!body.ok) return body.response;

  // request.signal срабатывает, если посетитель ушёл со страницы: запросы к модели отменяются
  const result: ReviewResponse = await reviewProgress({
    ...parseReviewContext(body.data),
    abortSignal: request.signal,
  });
  return Response.json(result);
}
