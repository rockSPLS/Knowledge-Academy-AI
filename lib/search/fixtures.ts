import "server-only";
import type { ModelResult } from "@/lib/llm/client";
import { answerSchema, type AnswerOutput, type AskAnswer, type Found } from "./search";
import indexFile from "./search-index.json";
import type { SearchIndexFile, SearchMode } from "./types";
import hallucination from "./fixtures/hallucination.json";
import notInMaterials from "./fixtures/not-in-materials.json";
import nothingFound from "./fixtures/nothing-found.json";
import wordsOnly from "./fixtures/words-only.json";

// Сохранённые ответы поиска: интерфейс разрабатывается и проверяется без запросов
// к модели (POST /api/search/dev, только при разработке). Файл — вопрос, какие фрагменты
// нашёл поиск (id фрагментов индекса) и что ответила модель — в том виде, в каком она
// ответила: null — ответ не по схеме, "unavailable" — модель была недоступна.
// Фрагменты берутся из текущего индекса, а ответ модели проходит ту же проверку
// номеров источников, что и настоящий.

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
// (статью изменили) и сохранённый ответ нужно записать заново
export function fixtureFound(fixture: SearchFixture): Found | null {
  const chunks = fixture.chunkIds.map((id) => index.chunks.find((chunk) => chunk.id === id));
  if (chunks.some((chunk) => !chunk)) return null;
  return { mode: fixture.mode, chunks: chunks.map((chunk) => chunk!) };
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
    into.chunkIds = request.chunkIds;
    into.answer = result.ok ? result.data : result.reason === "invalid-output" ? null : "unavailable";
    return result;
  };
}
