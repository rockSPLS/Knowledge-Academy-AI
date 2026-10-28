import { z } from "zod";
import { MAX_SEARCH_REQUEST_BYTES } from "@/lib/llm/limits";
import { consumeReviewRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { rateLimitedResponse } from "@/lib/llm/responses";
import { fixtureMaterial, recordingReview, replayReview, reviewFixtures, type ReviewFixture } from "@/lib/review/fixtures";
import { askReview, reviewProgress } from "@/lib/review/review";
import { parseReviewContext } from "@/lib/review/request";

// POST /api/review/dev — разбор для разработки, только при разработке.
// - { fixture: "articles", progress?, journeys? } — по сохранённому разбору (lib/review/fixtures/),
//   без запросов к модели и сервису эмбеддингов; «нет прогресса» и «нет ошибок» — по прогрессу
//   из запроса, как в обычном разборе;
// - { record: true, progress?, journeys? } — настоящий разбор; в поле recording — ответ модели
//   в формате сохранённых разборов, в полях prompt, usage и ms — что получила модель, расход
//   токенов и время (для проверки промпта и замеров).
// Возвращает то же, что POST /api/review.

export const maxDuration = 60;

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
  const context = parseReviewContext(body.data);

  if ("fixture" in parsed.data) {
    const fixture = reviewFixtures[parsed.data.fixture];
    if (!fixture) return Response.json({ error: "Нет такого сохранённого разбора" }, { status: 404 });
    const material = fixtureMaterial(fixture, context.journeys);
    if (!material) {
      return Response.json(
        { error: "Фрагментов сохранённого разбора нет в индексе или среди путешествий — создайте путешествие из примера" },
        { status: 409 },
      );
    }
    return Response.json(
      await reviewProgress({ ...context, ask: replayReview(fixture), material, abortSignal: request.signal }),
    );
  }

  // Настоящие запросы — под тем же лимитом, что и обычный разбор
  const limit = consumeReviewRequest(request);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);
  const recording: Partial<ReviewFixture> = { description: "", fragmentIds: [], output: null };
  let prompt = "";
  let usage: unknown = null;
  const started = Date.now();
  const result = await reviewProgress({
    ...context,
    ask: recordingReview(async (request) => {
      prompt = request.prompt;
      return askReview({ ...request, onUsage: (value) => (usage = value) });
    }, recording),
    onMaterial: (material) => (recording.fragmentIds = material.fragments.map((fragment) => fragment.id)),
    abortSignal: request.signal,
  });
  return Response.json({ ...result, recording, prompt, usage, ms: Date.now() - started });
}
