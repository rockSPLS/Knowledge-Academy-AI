import { z } from "zod";
import * as calibration from "@/lib/exercises/handlers/calibration";
import * as freeAnswer from "@/lib/exercises/handlers/freeAnswer";
import { applyRevealRule, checkAnswer } from "@/lib/exercises/server";
import type { CalibrationExercise, FreeAnswerExercise } from "@/lib/exercises/types";
import { fixtureJudge } from "@/lib/journey/fixtures";
import {
  judgeAnswer,
  judgeCalibration,
  openEvaluation,
  sealEvaluation,
  type AskJudge,
} from "@/lib/journey/judge";
import { isSealConfigured, unsealJourney } from "@/lib/journey/seal";
import type { Journey, JourneyExercise } from "@/lib/journey/types";
import { consumeEvaluationRequest } from "@/lib/llm/rateLimit";
import { readJsonBody } from "@/lib/llm/request";
import { judgeFailureResponse, rateLimitedResponse } from "@/lib/llm/responses";

// POST /api/journey/exercise — работа с упражнением сгенерированного путешествия.
// Браузер присылает зашифрованное путешествие (sealed) и id упражнения; сервер
// расшифровывает путешествие и берёт из него правильные ответы и подсказку.
// - { action: "check", answer, reveal? } — проверка ответа, как POST /api/check:
//   разбор с правильными ответами — только при верном ответе или reveal = true;
//   у свободного ответа ещё evaluation — запечатанная оценка прошлой попытки
//   (раскрытие без нового запроса к модели), в ответе — новая запечатанная оценка;
//   калибровку тоже оценивает модель, разбор приходит сразу (попытка одна);
// - { action: "hint" } — подсказка к упражнению;
// - { action: "skip" } — время вышло, а ответа нет (или свободный ответ не удалось
//   оценить): только общее объяснение, у свободного ответа — ещё и образец,
//   у калибровки — правильные ответы.
// Модель вызывается только для оценки свободного ответа и калибровки — у неё свой лимит частоты;
// остальное проверяется без модели и без лимита (как и /api/check).

// Зашифрованное путешествие обычно 15–35 КБ, но бывает до ~270 КБ — лимит с запасом.
// Обычный лимит запросов к модели (MAX_REQUEST_BYTES) рассчитан на текст пользователя и меньше
const MAX_BODY_BYTES = 400_000;

// Оценка ответа моделью — до двух запросов по 25 с (lib/journey/judge.ts)
export const maxDuration = 60;

const base = {
  sealed: z.string().min(1),
  exerciseId: z.string().min(1).max(100),
};

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    ...base,
    action: z.literal("check"),
    answer: z.unknown(),
    reveal: z.boolean().optional(),
    // Свободный ответ: запечатанная оценка прошлой попытки — раскрытие без нового запроса к модели
    evaluation: z.string().max(10_000).optional(),
  }),
  z.object({ ...base, action: z.literal("hint") }),
  z.object({ ...base, action: z.literal("skip") }),
]);

export async function POST(request: Request) {
  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = requestSchema.safeParse(body.data);
  if (!parsed.success) {
    return Response.json({ code: "bad-request", error: "Некорректный запрос" }, { status: 400 });
  }

  if (!isSealConfigured()) {
    console.error("[journey] не задан JOURNEY_SECRET (не короче 32 символов)");
    return Response.json(
      { code: "not-configured", error: "Проверка ответов сейчас недоступна" },
      { status: 503 },
    );
  }

  const journey = unsealJourney(parsed.data.sealed);
  if (!journey) {
    // Подделано, повреждено или зашифровано другим секретом (секрет сменили)
    return Response.json(
      { code: "bad-journey", error: "Путешествие повреждено или устарело. Составьте новое." },
      { status: 400 },
    );
  }

  const found = findExercise(journey.checkpoints, parsed.data.exerciseId);
  if (!found) {
    return Response.json({ code: "not-found", error: "Упражнение не найдено" }, { status: 404 });
  }

  switch (parsed.data.action) {
    case "hint":
      return Response.json({ hint: found.hint });
    case "skip":
      return Response.json({ explanation: skipExplanation(found.exercise) });
    case "check": {
      if (found.exercise.type === "free-answer") {
        return checkFreeAnswer(request, journey, found.exercise, parsed.data);
      }
      if (found.exercise.type === "calibration") {
        return checkCalibration(request, journey, found.exercise, parsed.data.answer);
      }
      const result = checkAnswer(found.exercise, parsed.data.answer, parsed.data.reveal ?? false);
      if (!result) {
        return Response.json(
          { code: "bad-request", error: "Ответ не подходит для этого упражнения" },
          { status: 400 },
        );
      }
      return Response.json(result);
    }
  }
}

// Свободный ответ: образец — после объяснения, отдельным абзацем; калибровка — правильные ответы
function skipExplanation(exercise: JourneyExercise["exercise"]): string {
  if (exercise.type === "free-answer") {
    return `${exercise.explanation}

Образец ответа: ${exercise.sample}`;
  }
  if (exercise.type === "calibration") {
    const answers = exercise.items.map((item) => `— ${item.question} Ответ: ${item.answer}`).join("\n");
    return `${exercise.explanation}

Правильные ответы:
${answers}`;
  }
  return exercise.explanation;
}

// Свободный ответ оценивает модель. Раскрытие после уже оценённой попытки берёт
// запечатанную оценку из браузера — без нового запроса и с тем же итогом
async function checkFreeAnswer(
  request: Request,
  journey: Journey,
  exercise: FreeAnswerExercise,
  data: { sealed: string; answer: unknown; reveal?: boolean; evaluation?: string },
): Promise<Response> {
  const answer = freeAnswer.answerSchema.safeParse(data.answer);
  if (!answer.success || freeAnswer.isBlankAnswer(answer.data)) {
    return Response.json(
      { code: "bad-request", error: "Ответ не подходит для этого упражнения" },
      { status: 400 },
    );
  }
  const binding = { sealedJourney: data.sealed, exerciseId: exercise.id, answer: answer.data.text };

  let evaluation = data.evaluation ? openEvaluation(data.evaluation, binding) : null;
  if (!evaluation) {
    const replay = judgeFor(request, journey);
    if (!replay.ok) return replay.response;
    const judged = await judgeAnswer(exercise, answer.data.text, replay.ask, request.signal);
    if (!judged.ok) return judgeFailureResponse(judged.reason);
    evaluation = judged.evaluation;
  }

  const result = applyRevealRule(freeAnswer.check(exercise, evaluation), data.reveal ?? false);
  return Response.json({ ...result, evaluation: sealEvaluation(binding, evaluation) });
}

// Калибровку тоже оценивает модель. Попытка одна, поэтому разбор отдаётся сразу
// и запечатывать оценку для раскрытия не нужно
async function checkCalibration(
  request: Request,
  journey: Journey,
  exercise: CalibrationExercise,
  rawAnswer: unknown,
): Promise<Response> {
  const answer = calibration.answerSchema.safeParse(rawAnswer);
  if (!answer.success || !calibration.isCompleteAnswer(exercise, answer.data)) {
    return Response.json(
      { code: "bad-request", error: "Ответ не подходит для этого упражнения" },
      { status: 400 },
    );
  }
  const replay = judgeFor(request, journey);
  if (!replay.ok) return replay.response;
  const judged = await judgeCalibration(
    exercise,
    calibration.answerTexts(exercise, answer.data),
    replay.ask,
    request.signal,
  );
  if (!judged.ok) return judgeFailureResponse(judged.reason);
  return Response.json(calibration.check(exercise, answer.data, judged.evaluation));
}

// Кто оценивает: при разработке путешествие из сохранённых ответов оценивается по ним же —
// без лимита; иначе настоящая модель, и запрос расходует лимит оценки
function judgeFor(
  request: Request,
  journey: Journey,
): { ok: true; ask: AskJudge | undefined } | { ok: false; response: Response } {
  const replay = fixtureJudge(journey);
  if (replay) return { ok: true, ask: replay };
  const limit = consumeEvaluationRequest(request);
  if (!limit.ok) return { ok: false, response: rateLimitedResponse(limit.retryAfterSec) };
  return { ok: true, ask: undefined };
}

function findExercise(
  checkpoints: { exercises: JourneyExercise[] }[],
  exerciseId: string,
): JourneyExercise | undefined {
  for (const checkpoint of checkpoints) {
    const found = checkpoint.exercises.find((item) => item.exercise.id === exerciseId);
    if (found) return found;
  }
  return undefined;
}
