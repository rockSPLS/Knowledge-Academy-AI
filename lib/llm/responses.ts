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

// Свободный ответ не удалось оценить. code у обоих — judge-failed: интерфейс
// предлагает попробовать ещё раз или пропустить упражнение без оценки
export function judgeFailureResponse(reason: ModelFailure): Response {
  const error =
    reason === "invalid-output"
      ? "Не получилось оценить ответ. Попробуйте ещё раз."
      : reason === "not-configured"
        ? "Оценка ответов не настроена — пропустите упражнение без оценки."
        : "Оценка ответа сейчас недоступна. Попробуйте ещё раз через минуту.";
  return Response.json(
    { code: "judge-failed", error },
    { status: reason === "invalid-output" ? 502 : 503 },
  );
}

// Путешествие по материалам портала: по теме ничего не нашлось (модель не вызывалась)
// или искать нечем — нет модели эмбеддингов, сервис не ответил
export function portalFailureResponse(reason: "not-in-materials" | "unavailable"): Response {
  return reason === "not-in-materials"
    ? Response.json(
        {
          code: "not-in-materials",
          error: "В материалах портала об этом нет. Попробуйте другую тему или постройте путешествие по своей теме.",
        },
        { status: 422 },
      )
    : Response.json(
        {
          code: "portal-unavailable",
          error: "Путешествие по материалам портала сейчас недоступно. Можно построить путешествие по своей теме.",
        },
        { status: 503 },
      );
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
