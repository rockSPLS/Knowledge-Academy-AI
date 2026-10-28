import { loadProgressData } from "@/components/progress/store";
import { buildProgressSummary, isEmptySummary } from "@/components/progress/summary";
import type { CheckResult } from "@/lib/exercises/types";
import type { PublicJourney } from "@/lib/journey/types";
import { loadSavedJourneys } from "./saved";

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
    // Сервер не ответил за отведённое время — понятный текст вместо общего «нет связи»
    if (signal?.aborted && signal.reason instanceof DOMException && signal.reason.name === "TimeoutError") {
      throw new JourneyApiError("Сервер слишком долго не отвечает. Попробуйте ещё раз.", "timeout");
    }
    // Запрос отменили сами (например, «Отменить» при генерации)
    if (signal?.aborted) throw error;
    throw new JourneyApiError("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.", "network");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (typeof data?.error === "string") {
      throw new JourneyApiError(data.error, typeof data?.code === "string" ? data.code : "unknown");
    }
    // 429 без нашего текста — ответил лимит Firewall на хостинге, а не наш сервер
    if (response.status === 429) {
      throw new JourneyApiError("Слишком много запросов. Попробуйте снова через несколько минут.", "rate-limited");
    }
    throw new JourneyApiError("Что-то пошло не так. Попробуйте ещё раз.", "unknown");
  }
  return data as T;
}

export type GeneratedJourney = { journey: PublicJourney; sealed: string };

export function generateJourney(source: string, signal: AbortSignal): Promise<GeneratedJourney> {
  return postJson("/api/journey", { source }, signal);
}

// Путешествие по материалам портала: тема и та же сводка прогресса, что у поиска, — по ней
// сервер находит темы статей, которые стоит повторить. Путешествия не отправляются
export function generatePortalJourney(topic: string, signal: AbortSignal): Promise<GeneratedJourney> {
  const summary = buildProgressSummary(loadProgressData(), loadSavedJourneys());
  return postJson("/api/journey", { topic, ...(!isEmptySummary(summary) && { progress: summary }) }, signal);
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
// Свободный ответ и калибровку оценивает модель: до двух попыток по 25 секунд (lib/journey/judge.ts)
const JUDGE_TIMEOUT_MS = 60_000;

// evaluation — у свободного ответа: запечатанная оценка, сервер присылает её с итогом.
// С ней раскрытие ответа не обращается к модели снова (у калибровки её нет: попытка одна)
export type JourneyCheckResult = CheckResult & { evaluation?: string | null };

export function checkJourneyAnswer(
  sealed: string,
  exerciseId: string,
  answer: unknown,
  reveal: boolean,
  // Ответ оценивает модель (свободный ответ, калибровка) — ждём дольше
  judged?: { evaluation?: string },
): Promise<JourneyCheckResult> {
  return postJson(
    "/api/journey/exercise",
    { action: "check", sealed, exerciseId, answer, reveal, evaluation: judged?.evaluation },
    AbortSignal.timeout(judged ? JUDGE_TIMEOUT_MS : EXERCISE_TIMEOUT_MS),
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
