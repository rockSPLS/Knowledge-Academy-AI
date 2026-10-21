import "server-only";
import type { z } from "zod";
import { generateStructured, type ModelFailure, type ModelResult } from "@/lib/llm/client";
import { buildCheckpoint, buildDoubts, checkPlan } from "./build";
import { EXERCISES_SYSTEM, PLAN_SYSTEM, exercisesPrompt, planPrompt, retryNote } from "./prompts";
import { checkpointExercisesSchema, planSchema } from "./schemas";
import type { Journey } from "./types";

// Генерация путешествия: план (шаг 1), затем упражнения всех чекпоинтов
// параллельно (шаг 2). Каждый ответ модели проверяется схемой и правилами
// build.ts; если не прошёл — шаг повторяется один раз с объяснением, что не так.
// Повторяется только неудачный шаг: сбой одного чекпоинта не переделывает остальные.

// Тайм-ауты одной попытки: на план — больше, в нём весь текст пользователя.
// С повтором худший случай — около 4,5 минуты (maxDuration маршрута — 300 с)
const PLAN_TIMEOUT_MS = 75_000;
const EXERCISES_TIMEOUT_MS = 60_000;
const PLAN_MAX_OUTPUT_TOKENS = 8000;
const EXERCISES_MAX_OUTPUT_TOKENS = 6000;
const ATTEMPTS = 2;

// Какой шаг цепочки спрашивает модель: по нему сохранённые ответы
// подставляются вместо настоящих запросов (fixtures.ts)
export type ModelStep = { kind: "plan" } | { kind: "checkpoint"; number: number };

export type AskModel = <T>(
  step: ModelStep,
  request: {
    schema: z.ZodType<T>;
    system: string;
    prompt: string;
    timeoutMs: number;
    maxOutputTokens: number;
    abortSignal?: AbortSignal;
  },
) => Promise<ModelResult<T>>;

// Настоящий запрос к модели
export const askModel: AskModel = (_step, request) => generateStructured(request);

export type GenerateResult =
  | { ok: true; journey: Journey }
  | { ok: false; reason: ModelFailure }
  // Материал не подходит; message — объяснение модели для пользователя
  | { ok: false; reason: "unsuitable"; message: string };

// Ответ на шаг: проверенное значение или причина неудачи после всех попыток
type StepResult<T> = { ok: true; value: T } | { ok: false; reason: ModelFailure };

// Один шаг с повтором. check возвращает текст ошибки (уйдёт модели при повторе) или null
async function runStep<T, R>(
  ask: AskModel,
  step: ModelStep,
  request: Parameters<AskModel>[1] & { schema: z.ZodType<T> },
  accept: (value: T) => { ok: true; value: R } | { ok: false; error: string },
): Promise<StepResult<R>> {
  let prompt = request.prompt;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    // Генерацию отменили — повторять незачем
    if (request.abortSignal?.aborted) return { ok: false, reason: "unavailable" };
    const result = await ask(step, { ...request, prompt });
    if (!result.ok) {
      // Модель недоступна или не настроена — повтор не поможет
      // (временные сбои сети библиотека уже повторила сама)
      if (result.reason !== "invalid-output") return result;
      console.error(`[journey] ${describeStep(step)}, попытка ${attempt}: ответ не по схеме`);
      prompt = request.prompt + retryNote(null);
      continue;
    }
    const accepted = accept(result.data);
    if (accepted.ok) return accepted;
    console.error(`[journey] ${describeStep(step)}, попытка ${attempt}: ${accepted.error}`);
    prompt = request.prompt + retryNote(accepted.error);
  }
  return { ok: false, reason: "invalid-output" };
}

function describeStep(step: ModelStep): string {
  return step.kind === "plan" ? "план" : `чекпоинт ${step.number}`;
}

// signal — отмена извне: посетитель закрыл страницу, не дождавшись путешествия
export async function generateJourney(
  source: string,
  ask: AskModel = askModel,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  // Общая отмена всех запросов: и извне, и когда один чекпоинт окончательно
  // не получился — тогда остальные дорабатывать незачем, путешествия всё равно не будет
  const controller = new AbortController();
  const abortSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  const plan = await runStep(
    ask,
    { kind: "plan" },
    {
      schema: planSchema,
      system: PLAN_SYSTEM,
      prompt: planPrompt(source),
      timeoutMs: PLAN_TIMEOUT_MS,
      maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS,
      abortSignal,
    },
    (value) => {
      // Неподходящий материал — не ошибка модели, повторять не нужно
      if (!value.suitable) return { ok: true, value };
      const error = checkPlan(value);
      return error ? { ok: false, error } : { ok: true, value };
    },
  );
  if (!plan.ok) return plan;
  if (!plan.value.suitable) {
    const message = plan.value.problem.trim().slice(0, 300);
    return {
      ok: false,
      reason: "unsuitable",
      message: message || "По этому материалу не получается составить путешествие.",
    };
  }

  // Причина первого окончательного сбоя: остальные чекпоинты после него
  // отменяются и «падают» уже из-за отмены
  let failure: ModelFailure | null = null;
  const steps = await Promise.all(
    plan.value.checkpoints.map(async (planned, index) => {
      const step = await runStep(
        ask,
        { kind: "checkpoint", number: index + 1 },
        {
          schema: checkpointExercisesSchema,
          system: EXERCISES_SYSTEM,
          prompt: exercisesPrompt(plan.value, planned, index + 1),
          timeoutMs: EXERCISES_TIMEOUT_MS,
          maxOutputTokens: EXERCISES_MAX_OUTPUT_TOKENS,
          abortSignal,
        },
        (value) => buildCheckpoint(planned, index + 1, value),
      );
      if (!step.ok && failure === null) {
        failure = step.reason;
        controller.abort();
      }
      return step;
    }),
  );
  if (failure !== null) return { ok: false, reason: failure };

  return {
    ok: true,
    journey: {
      version: 1,
      title: plan.value.title.trim(),
      createdAt: new Date().toISOString(),
      doubts: buildDoubts(plan.value),
      checkpoints: steps.flatMap((step) => (step.ok ? [step.value] : [])),
    },
  };
}
