import { z } from "zod";
import { MAX_SEARCH_REQUEST_BYTES } from "@/lib/llm/limits";
import { consumeSearchRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { rateLimitedResponse } from "@/lib/llm/responses";
import {
  fixtureFound,
  recordingAnswer,
  replayAnswer,
  searchFixtures,
  toFixtureChunkId,
  type SearchFixture,
} from "@/lib/search/fixtures";
import { parseQuestion, parseSearchContext } from "@/lib/search/request";
import { askAnswer, findChunks, searchAndAnswer } from "@/lib/search/search";

// POST /api/search/dev — поиск для разработки, только при разработке.
// - { fixture: "hallucination", journeys?, progress? } — по сохранённому ответу
//   (lib/search/fixtures/), без запросов к модели и сервису эмбеддингов; путешествия
//   и прогресс — как у обычного поиска: от них зависят ярлыки, объяснения и фрагменты
//   путешествий;
// - { question, journeys?, progress?, record: true } — настоящий поиск и ответ модели;
//   ответ возвращается в поле recording в формате сохранённых ответов.
// Возвращает то же, что POST /api/search.

export const maxDuration = 60;

// Путешествия и прогресс разбираются так же, как в обычном поиске (lib/search/request.ts)
const requestSchema = z.union([z.object({ fixture: z.string() }), z.object({ record: z.literal(true) })]);

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await readJsonBody(request, MAX_SEARCH_REQUEST_BYTES);
  if (!body.ok) return body.response;
  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) {
    return Response.json({ code: "bad-request", error: "Некорректный запрос" }, { status: 400 });
  }
  const { journeys, progress } = parseSearchContext(body.data);

  if ("fixture" in parsed.data) {
    const fixture = searchFixtures[parsed.data.fixture];
    if (!fixture) return Response.json({ error: "Нет такого сохранённого ответа" }, { status: 404 });
    const found = fixtureFound(fixture, journeys);
    if (!found) {
      return Response.json(
        { error: "Фрагментов сохранённого ответа нет в индексе или среди сохранённых путешествий — запишите его заново" },
        { status: 409 },
      );
    }
    return Response.json(
      await searchAndAnswer({
        question: fixture.question,
        progress,
        ask: replayAnswer(fixture),
        abortSignal: request.signal,
        found,
      }),
    );
  }

  // Настоящие запросы — под тем же лимитом, что и обычный поиск
  const limit = consumeSearchRequest(request);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);
  const question = parseQuestion(body.data);
  if (question === null) {
    return Response.json({ code: "bad-request", error: "Некорректный запрос" }, { status: 400 });
  }
  const found = await findChunks(question, request.signal, journeys);
  const recording: Partial<SearchFixture> = {
    description: "",
    question,
    mode: found.mode,
    chunkIds: found.chunks.map(toFixtureChunkId),
    answer: null,
  };
  const result = await searchAndAnswer({
    question,
    progress,
    ask: recordingAnswer(askAnswer, recording),
    abortSignal: request.signal,
    found,
  });
  return Response.json({ ...result, recording });
}
