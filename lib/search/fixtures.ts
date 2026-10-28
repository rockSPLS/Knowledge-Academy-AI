import "server-only";
import type { ModelResult } from "@/lib/llm/client";
import { journeyChunks } from "./journeys";
import { answerSchema, type AnswerOutput, type AskAnswer, type Found, type Fragment } from "./search";
import indexFile from "./search-index.json";
import type { JourneySearchInput, SearchIndexFile, SearchMode } from "./types";
import hallucination from "./fixtures/hallucination.json";
import notInMaterials from "./fixtures/not-in-materials.json";
import nothingFound from "./fixtures/nothing-found.json";
import wordsOnly from "./fixtures/words-only.json";

// Сохранённые ответы поиска: интерфейс разрабатывается и проверяется без запросов
// к модели (POST /api/search/dev, только при разработке). Файл — вопрос, какие фрагменты
// нашёл поиск (id фрагментов индекса) и что ответила модель — в том виде, в каком она
// ответила: null — ответ не по схеме, "unavailable" — модель была недоступна.
// Фрагменты берутся из текущего индекса, а ответ модели проходит ту же проверку
// номеров источников, что и настоящий. Фрагмент путешествия записан как
// journey-title:<название путешествия>#<номер чекпоинта с нуля>: id путешествий у каждого
// браузера свои, поэтому при повторе он ищется среди путешествий из запроса по названию.

export type SearchFixture = {
  description: string;
  question: string;
  mode: SearchMode;
  chunkIds: string[];
  answer: AnswerOutput | null | "unavailable";
};

export const searchFixtures: Record<string, SearchFixture> = {
  hallucination: hallucination as SearchFixture,
  "not-in-materials": notInMaterials as SearchFixture,
  "words-only": wordsOnly as SearchFixture,
  "nothing-found": nothingFound as SearchFixture,
};

const index = indexFile as SearchIndexFile;

// Найденные фрагменты из сохранённого ответа; null — какого-то фрагмента уже нет в индексе
// (статью изменили) или нужного путешествия нет среди присланных, и сохранённый ответ
// нужно записать заново (или сначала создать путешествие из примера)
export function fixtureFound(fixture: SearchFixture, journeys: JourneySearchInput[]): Found | null {
  const chunks = fixture.chunkIds.map((id): Fragment | undefined => {
    const journey = /^journey-title:(.+)#(\d+)$/.exec(id);
    if (!journey) return index.chunks.find((chunk) => chunk.id === id);
    const saved = journeys.find((item) => item.title === journey[1]);
    return saved ? journeyChunks(saved, null)[Number(journey[2])] : undefined;
  });
  if (chunks.some((chunk) => !chunk)) return null;
  return { mode: fixture.mode, chunks: chunks.map((chunk) => chunk!) };
}

// id фрагмента для записи сохранённого ответа
export function toFixtureChunkId(chunk: Fragment): string {
  return chunk.kind === "journey" ? `journey-title:${chunk.journeyTitle}#${chunk.checkpointIndex}` : chunk.id;
}

// «Модель», которая отвечает сохранённым ответом
export function replayAnswer(fixture: SearchFixture): AskAnswer {
  return async (): Promise<ModelResult<AnswerOutput>> => {
    if (fixture.answer === "unavailable") return { ok: false, reason: "unavailable" };
    const parsed = answerSchema.safeParse(fixture.answer);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "invalid-output" };
  };
}

// Обёртка над настоящей моделью: запоминает её ответ в формате SearchFixture
export function recordingAnswer(inner: AskAnswer, into: Partial<SearchFixture>): AskAnswer {
  return async (request) => {
    const result = await inner(request);
    into.answer = result.ok ? result.data : result.reason === "invalid-output" ? null : "unavailable";
    return result;
  };
}
