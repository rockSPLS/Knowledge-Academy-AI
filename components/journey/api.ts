import type { CheckResult } from "@/lib/exercises/types";
import type { PublicJourney } from "@/lib/journey/types";

// Запросы страницы путешествия к серверу. Ошибка сервера превращается в JourneyApiError
// с текстом, который можно показать пользователю (поле error ответа API).

export class JourneyApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new JourneyApiError("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.", "network");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new JourneyApiError(
      typeof data?.error === "string" ? data.error : "Что-то пошло не так. Попробуйте ещё раз.",
      typeof data?.code === "string" ? data.code : "unknown",
    );
  }
  return data as T;
}

export type GeneratedJourney = { journey: PublicJourney; sealed: string };

export function generateJourney(source: string, signal: AbortSignal): Promise<GeneratedJourney> {
  return postJson("/api/journey", { source }, signal);
}

// Только при разработке: путешествие из сохранённых ответов модели, без запросов к ней
export async function loadFixtureJourney(fixture: string, signal: AbortSignal): Promise<GeneratedJourney> {
  const data = await postJson<{ journey: PublicJourney; sealed: string | null }>(
    "/api/journey/dev",
    { fixture },
    signal,
  );
  if (!data.sealed) throw new JourneyApiError("Не задан JOURNEY_SECRET", "not-configured");
  return { journey: data.journey, sealed: data.sealed };
}

// Если сервер не ответил за 10 секунд — ошибка, а не вечное ожидание (как у /api/check)
const EXERCISE_TIMEOUT_MS = 10_000;

export function checkJourneyAnswer(
  sealed: string,
  exerciseId: string,
  answer: unknown,
  reveal: boolean,
): Promise<CheckResult> {
  return postJson(
    "/api/journey/exercise",
    { action: "check", sealed, exerciseId, answer, reveal },
    AbortSignal.timeout(EXERCISE_TIMEOUT_MS),
  );
}

export async function fetchHint(sealed: string, exerciseId: string): Promise<string> {
  const data = await postJson<{ hint: string }>(
    "/api/journey/exercise",
    { action: "hint", sealed, exerciseId },
    AbortSignal.timeout(EXERCISE_TIMEOUT_MS),
  );
  return data.hint;
}

export async function fetchSkipExplanation(sealed: string, exerciseId: string): Promise<string> {
  const data = await postJson<{ explanation: string }>(
    "/api/journey/exercise",
    { action: "skip", sealed, exerciseId },
    AbortSignal.timeout(EXERCISE_TIMEOUT_MS),
  );
  return data.explanation;
}
