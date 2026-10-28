import "server-only";
import type { ModelResult } from "@/lib/llm/client";
import type { JourneySearchInput } from "@/lib/search/types";
import { fragmentById, type ReviewMaterial } from "./material";
import { reviewSchema, type AskReview, type ReviewOutput } from "./review";
import articles from "./fixtures/articles.json";
import badNumbers from "./fixtures/bad-numbers.json";
import invalid from "./fixtures/invalid.json";
import journeys from "./fixtures/journeys.json";
import noSources from "./fixtures/no-sources.json";
import unavailable from "./fixtures/unavailable.json";

// Сохранённые разборы: блок «Разбор ошибок» разрабатывается и проверяется без запросов
// к модели (POST /api/review/dev, только при разработке). Файл — какие фрагменты получила
// модель (id фрагментов индекса, чекпоинт — journey-title:<название путешествия>#<понятие>:
// id путешествий у каждого браузера свои) и что она ответила: null — ответ не по схеме,
// "unavailable" — модель недоступна. Ответ проходит ту же проверку номеров, что и настоящий,
// а «нет прогресса» и «нет ошибок» считаются по прогрессу из запроса, как обычно.

export type ReviewFixture = {
  description: string;
  fragmentIds: string[];
  output: ReviewOutput | null | "unavailable";
};

export const reviewFixtures: Record<string, ReviewFixture> = {
  articles: articles as ReviewFixture,
  journeys: journeys as ReviewFixture,
  "bad-numbers": badNumbers as ReviewFixture,
  "no-sources": noSources as ReviewFixture,
  invalid: invalid as ReviewFixture,
  unavailable: unavailable as ReviewFixture,
};

// Фрагменты сохранённого разбора; null — какого-то фрагмента уже нет в индексе или нужного
// путешествия нет среди присланных (сначала создайте путешествие из примера)
export function fixtureMaterial(fixture: ReviewFixture, journeyList: JourneySearchInput[]): ReviewMaterial | null {
  const fragments = fixture.fragmentIds.map((id) => fragmentById(id, journeyList));
  if (fragments.some((fragment) => !fragment)) return null;
  return { topics: [], fragments: fragments.map((fragment) => fragment!) };
}

// «Модель», которая отвечает сохранённым разбором
export function replayReview(fixture: ReviewFixture): AskReview {
  return async (): Promise<ModelResult<ReviewOutput>> => {
    if (fixture.output === "unavailable") return { ok: false, reason: "unavailable" };
    const parsed = reviewSchema.safeParse(fixture.output);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "invalid-output" };
  };
}

// Обёртка над настоящей моделью: запоминает её ответ в формате ReviewFixture
export function recordingReview(inner: AskReview, into: Partial<ReviewFixture>): AskReview {
  return async (request) => {
    const result = await inner(request);
    into.output = result.ok ? result.data : result.reason === "invalid-output" ? null : "unavailable";
    return result;
  };
}
