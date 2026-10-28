import { z } from "zod";
import { MAX_QUESTION_LENGTH } from "@/lib/llm/limits";
import { consumeSearchRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { rateLimitedResponse } from "@/lib/llm/responses";
import { fixtureFound, recordingAnswer, replayAnswer, searchFixtures, type SearchFixture } from "@/lib/search/fixtures";
import { askAnswer, findChunks, searchAndAnswer } from "@/lib/search/search";

// POST /api/search/dev — поиск для разработки, только при разработке.
// - { fixture: "hallucination" } — по сохранённому ответу (lib/search/fixtures/), без запросов
//   к модели и сервису эмбеддингов;
// - { question, record: true } — настоящий поиск и ответ модели; ответ возвращается
//   в поле recording в формате сохранённых ответов.
// Возвращает то же, что POST /api/search.

export const maxDuration = 60;

const requestSchema = z.union([
  z.object({ fixture: z.string() }),
  z.object({ question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH), record: z.literal(true) }),
]);

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await readJsonBody(request, 10_000);
  if (!body.ok) return body.response;
  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) {
    return Response.json({ code: "bad-request", error: "Некорректный запрос" }, { status: 400 });
  }

  if ("fixture" in parsed.data) {
    const fixture = searchFixtures[parsed.data.fixture];
    if (!fixture) return Response.json({ error: "Нет такого сохранённого ответа" }, { status: 404 });
    const found = fixtureFound(fixture);
    if (!found) {
      return Response.json({ error: "Фрагментов сохранённого ответа нет в индексе — запишите его заново" }, { status: 409 });
    }
    return Response.json(await searchAndAnswer(fixture.question, replayAnswer(fixture), request.signal, found));
  }

  // Настоящие запросы — под тем же лимитом, что и обычный поиск
  const limit = consumeSearchRequest(request);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);
  const { question } = parsed.data;
  const found = await findChunks(question, request.signal);
  const recording: Partial<SearchFixture> = {
    description: "",
    question,
    mode: found.mode,
    chunkIds: found.chunks.map((chunk) => chunk.id),
    answer: null,
  };
  const result = await searchAndAnswer(question, recordingAnswer(askAnswer, recording), request.signal, found);
  return Response.json({ ...result, recording });
}
