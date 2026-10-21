import { z } from "zod";
import { fixtures, recordingModel, replayModel, type Fixture } from "@/lib/journey/fixtures";
import { askModel, generateJourney, type AskModel } from "@/lib/journey/generate";
import { toPublicJourney } from "@/lib/journey/public";
import { sealJourney, unsealJourney } from "@/lib/journey/seal";
import { MAX_SOURCE_LENGTH } from "@/lib/llm/limits";
import { consumeModelRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { modelFailureResponse, rateLimitedResponse } from "@/lib/llm/responses";

// POST /api/journey/dev — генерация путешествия для разработки, только при разработке.
// - { fixture: "photosynthesis" } — по сохранённым ответам модели, без запросов к ней;
// - { responses: { description, source, plan, checkpoints } } — то же по ответам из запроса
//   (проверка отдельных случаев: ошибка в ответе, повтор, отказ);
// - { source, record: true } — настоящая генерация; ответы модели возвращаются
//   в поле recording в формате сохранённых ответов (lib/journey/fixtures/);
// - { unseal: "v1...." } — расшифровка зашифрованного путешествия (null — подделано или повреждено).
// Возвращает то же, что POST /api/journey, и для проверки — полное путешествие (full)
// и результат расшифровки (roundTrip). Без JOURNEY_SECRET sealed = null.

export const maxDuration = 300;

const fixtureSchema = z.object({
  description: z.string(),
  source: z.string(),
  plan: z.array(z.unknown()),
  checkpoints: z.array(z.array(z.unknown())),
});

const requestSchema = z.union([
  z.object({ fixture: z.string() }),
  z.object({ responses: fixtureSchema }),
  z.object({ source: z.string().trim().min(1).max(MAX_SOURCE_LENGTH), record: z.literal(true) }),
  z.object({ unseal: z.string() }),
]);

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Не найдено" }, { status: 404 });
  }

  const body = await readJsonBody(request, 1_000_000);
  if (!body.ok) return body.response;
  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) {
    return Response.json({ code: "bad-request", error: "Некорректный запрос" }, { status: 400 });
  }

  if ("unseal" in parsed.data) {
    return Response.json({ journey: unsealJourney(parsed.data.unseal) });
  }

  let source: string;
  let ask: AskModel;
  let recording: Pick<Fixture, "plan" | "checkpoints"> | undefined;
  if ("fixture" in parsed.data) {
    const fixture = fixtures[parsed.data.fixture];
    if (!fixture) return Response.json({ error: "Нет таких сохранённых ответов" }, { status: 404 });
    source = fixture.source;
    ask = replayModel(fixture);
  } else if ("responses" in parsed.data) {
    source = parsed.data.responses.source;
    ask = replayModel(parsed.data.responses);
  } else {
    // Настоящие запросы к модели — под тем же лимитом, что и обычная генерация
    const limit = consumeModelRequest(request);
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);
    source = parsed.data.source;
    recording = { plan: [], checkpoints: [] };
    ask = recordingModel(askModel, recording);
  }

  const result = await generateJourney(source, ask, request.signal);
  if (!result.ok) {
    const failure =
      result.reason === "unsuitable"
        ? Response.json({ code: "unsuitable", error: result.message }, { status: 422 })
        : modelFailureResponse(result.reason);
    if (!recording) return failure;
    return Response.json(
      { ...(await failure.json()), recording: { description: "", source, ...recording } },
      { status: failure.status },
    );
  }

  const sealed = sealJourney(result.journey);
  const roundTrip = sealed
    ? JSON.stringify(unsealJourney(sealed)) === JSON.stringify(result.journey)
    : null;
  return Response.json({
    journey: toPublicJourney(result.journey),
    sealed,
    full: result.journey,
    roundTrip,
    ...(recording && { recording: { description: "", source, ...recording } }),
  });
}
