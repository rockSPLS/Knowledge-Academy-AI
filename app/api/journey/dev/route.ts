import { z } from "zod";
import * as freeAnswer from "@/lib/exercises/handlers/freeAnswer";
import { MAX_FREE_ANSWER_LENGTH } from "@/lib/exercises/limits";
import {
  fixtures,
  recordingJudge,
  recordingModel,
  replayModel,
  type Fixture,
} from "@/lib/journey/fixtures";
import { askModel, generateJourney, type AskModel } from "@/lib/journey/generate";
import { askJudge, judgeAnswer } from "@/lib/journey/judge";
import { toPublicJourney } from "@/lib/journey/public";
import { sealJourney, unsealJourney } from "@/lib/journey/seal";
import { MAX_SOURCE_LENGTH } from "@/lib/llm/limits";
import { consumeEvaluationRequest, consumeModelRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { modelFailureResponse, rateLimitedResponse } from "@/lib/llm/responses";

// POST /api/journey/dev — генерация путешествия для разработки, только при разработке.
// - { fixture: "photosynthesis" } — по сохранённым ответам модели, без запросов к ней;
//   свободные ответы такого путешествия тоже оцениваются по сохранённым ответам;
// - { judge: { fixture, exerciseId, answer } } — настоящая оценка свободного ответа
//   из сохранённого путешествия (подбор промпта оценщика); ответы модели возвращаются
//   в поле recording в формате сохранённых оценок (поле judge в lib/journey/fixtures/);
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
  z.object({
    judge: z.object({
      fixture: z.string(),
      exerciseId: z.string(),
      answer: z.string().trim().min(1).max(MAX_FREE_ANSWER_LENGTH),
    }),
  }),
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
  if ("judge" in parsed.data) return judgeWithModel(request, parsed.data.judge);

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

  // Путешествие из сохранённых ответов: свободные ответы оцениваются по ним же
  if ("fixture" in parsed.data) result.journey.fixture = parsed.data.fixture;

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

// Настоящая оценка свободного ответа из сохранённого путешествия — под тем же
// лимитом, что и обычная оценка
async function judgeWithModel(
  request: Request,
  { fixture: name, exerciseId, answer }: { fixture: string; exerciseId: string; answer: string },
): Promise<Response> {
  const fixture = fixtures[name];
  if (!fixture) return Response.json({ error: "Нет таких сохранённых ответов" }, { status: 404 });
  const built = await generateJourney(fixture.source, replayModel(fixture));
  if (!built.ok) return Response.json({ error: "Сохранённые ответы не собрались" }, { status: 500 });
  const exercise = built.journey.checkpoints
    .flatMap((checkpoint) => checkpoint.exercises)
    .map((item) => item.exercise)
    .find((item) => item.id === exerciseId);
  if (exercise?.type !== "free-answer") {
    return Response.json({ error: "Нет такого свободного ответа" }, { status: 404 });
  }

  const limit = consumeEvaluationRequest(request);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);
  const responses: unknown[] = [];
  const judged = await judgeAnswer(exercise, answer, recordingJudge(askJudge, responses), request.signal);
  return Response.json({
    result: judged.ok ? freeAnswer.check(exercise, judged.evaluation) : judged,
    recording: { exerciseId, answer, responses },
  });
}
