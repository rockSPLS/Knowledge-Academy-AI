import { z } from "zod";
import * as calibration from "@/lib/exercises/handlers/calibration";
import * as freeAnswer from "@/lib/exercises/handlers/freeAnswer";
import {
  CALIBRATION_ITEMS_MAX,
  MAX_CALIBRATION_ANSWER_LENGTH,
  MAX_FREE_ANSWER_LENGTH,
} from "@/lib/exercises/limits";
import {
  fixtures,
  fixtureSource,
  recordingJudge,
  recordingModel,
  replayModel,
  type Fixture,
} from "@/lib/journey/fixtures";
import { askModel, generateJourney, type AskModel } from "@/lib/journey/generate";
import type { PortalMaterial } from "@/lib/journey/portal";
import { askJudge, judgeAnswer, judgeCalibration } from "@/lib/journey/judge";
import { toPublicJourney } from "@/lib/journey/public";
import { sealJourney, unsealJourney } from "@/lib/journey/seal";
import { runJourneySelfCheck } from "@/lib/journey/selfCheck";
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
// - { judge: { fixture, exerciseId, answers: [{ text, confident }] } } — то же для калибровки;
// - { responses: { description, source, portal?, plan, checkpoints } } — то же по ответам из запроса
//   (проверка отдельных случаев: ошибка в ответе, повтор, отказ, чужие номера фрагментов);
//   с portal — путешествие по материалам портала из сохранённых id фрагментов (lib/journey/fixtures.ts);
// - { source, record: true } — настоящая генерация; ответы модели возвращаются
//   в поле recording в формате сохранённых ответов (lib/journey/fixtures/);
// - { unseal: "v1...." } — расшифровка зашифрованного путешествия (null — подделано или повреждено);
// - { selfCheck: true } — самопроверка раскладки, сохранённых примеров и запасных упражнений
//   без запросов к модели (lib/journey/selfCheck.ts): { passed, failures }.
// Возвращает то же, что POST /api/journey, и для проверки — полное путешествие (full)
// и результат расшифровки (roundTrip). Без JOURNEY_SECRET sealed = null.

export const maxDuration = 300;

const fixtureSchema = z.object({
  description: z.string(),
  source: z.string(),
  portal: z.object({ topic: z.string(), progress: z.unknown(), fragments: z.array(z.string()) }).optional(),
  plan: z.array(z.unknown()),
  checkpoints: z.array(z.array(z.unknown())),
});

const requestSchema = z.union([
  z.object({ fixture: z.string() }),
  z.object({ responses: fixtureSchema }),
  z.object({ source: z.string().trim().min(1).max(MAX_SOURCE_LENGTH), record: z.literal(true) }),
  z.object({ unseal: z.string() }),
  z.object({ selfCheck: z.literal(true) }),
  z.object({
    judge: z.object({
      fixture: z.string(),
      exerciseId: z.string(),
      answer: z.string().trim().min(1).max(MAX_FREE_ANSWER_LENGTH),
    }),
  }),
  z.object({
    judge: z.object({
      fixture: z.string(),
      exerciseId: z.string(),
      answers: z
        .array(z.object({ text: z.string().trim().min(1).max(MAX_CALIBRATION_ANSWER_LENGTH), confident: z.boolean() }))
        .max(CALIBRATION_ITEMS_MAX),
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
  if ("selfCheck" in parsed.data) return Response.json(await runJourneySelfCheck());
  if ("judge" in parsed.data) return judgeWithModel(request, parsed.data.judge);

  let source: string | PortalMaterial;
  let ask: AskModel;
  let recording: Pick<Fixture, "plan" | "checkpoints"> | undefined;
  if ("fixture" in parsed.data) {
    const fixture = fixtures[parsed.data.fixture];
    if (!fixture) return Response.json({ error: "Нет таких сохранённых ответов" }, { status: 404 });
    source = fixtureSource(fixture);
    ask = replayModel(fixture);
  } else if ("responses" in parsed.data) {
    source = fixtureSource(parsed.data.responses);
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

// Настоящая оценка свободного ответа или калибровки из сохранённого путешествия — под тем же
// лимитом, что и обычная оценка
async function judgeWithModel(
  request: Request,
  judge:
    | { fixture: string; exerciseId: string; answer: string }
    | { fixture: string; exerciseId: string; answers: { text: string; confident: boolean }[] },
): Promise<Response> {
  const { fixture: name, exerciseId } = judge;
  const fixture = fixtures[name];
  if (!fixture) return Response.json({ error: "Нет таких сохранённых ответов" }, { status: 404 });
  const built = await generateJourney(fixtureSource(fixture), replayModel(fixture));
  if (!built.ok) return Response.json({ error: "Сохранённые ответы не собрались" }, { status: 500 });
  const exercise = built.journey.checkpoints
    .flatMap((checkpoint) => checkpoint.exercises)
    .map((item) => item.exercise)
    .find((item) => item.id === exerciseId);
  const responses: unknown[] = [];
  const ask = recordingJudge(askJudge, responses);

  if (exercise?.type === "calibration" && "answers" in judge) {
    const answer = {
      answers: Object.fromEntries(exercise.items.map((item, index) => [item.id, judge.answers[index]])),
    };
    if (judge.answers.length !== exercise.items.length || !calibration.isCompleteAnswer(exercise, answer)) {
      return Response.json({ error: "Нужно по ответу на каждый вопрос" }, { status: 400 });
    }
    const limit = consumeEvaluationRequest(request);
    if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);
    const texts = calibration.answerTexts(exercise, answer);
    const judged = await judgeCalibration(exercise, texts, ask, request.signal);
    return Response.json({
      result: judged.ok ? calibration.check(exercise, answer, judged.evaluation) : judged,
      recording: { exerciseId, answer: texts.join("\n"), responses },
    });
  }
  if (exercise?.type !== "free-answer" || !("answer" in judge)) {
    return Response.json({ error: "Нет такого упражнения, которое оценивает ИИ" }, { status: 404 });
  }

  const limit = consumeEvaluationRequest(request);
  if (!limit.ok) return rateLimitedResponse(limit.retryAfterSec);
  const judged = await judgeAnswer(exercise, judge.answer, ask, request.signal);
  return Response.json({
    result: judged.ok ? freeAnswer.check(exercise, judged.evaluation) : judged,
    recording: { exerciseId, answer: judge.answer, responses },
  });
}
