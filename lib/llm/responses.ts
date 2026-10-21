import "server-only";
import type { ModelFailure } from "./client";

// Общие ответы API для маршрутов, которые обращаются к модели.
// Поле code — для интерфейса, error — текст, который можно показать пользователю.

const UNAVAILABLE_MESSAGE =
  "Генерация сейчас недоступна. Статьи, упражнения и итоговый тест работают как обычно.";

export function modelFailureResponse(reason: ModelFailure): Response {
  if (reason === "invalid-output") {
    return Response.json(
      { code: reason, error: "Модель ответила некорректно. Попробуйте ещё раз." },
      { status: 502 },
    );
  }
  return Response.json({ code: reason, error: UNAVAILABLE_MESSAGE }, { status: 503 });
}

export function rateLimitedResponse(retryAfterSec: number): Response {
  const minutes = Math.ceil(retryAfterSec / 60);
  return Response.json(
    {
      code: "rate-limited",
      error: `Слишком много запросов. Попробуйте снова через ${minutes} мин.`,
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}
