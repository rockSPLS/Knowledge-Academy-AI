import "server-only";
import type { z } from "zod";
import { generateStructured, type ModelFailure, type ModelResult } from "@/lib/llm/client";
import { buildCheckpoint, buildDoubts, checkPlan } from "./build";
import { layoutJourney } from "./layout";
import { checkPortalPlan, type PortalMaterial } from "./portal";
import {
  EXERCISES_SYSTEM,
  PLAN_SYSTEM,
  PORTAL_PLAN_SYSTEM,
  exercisesPrompt,
  planPrompt,
  portalPlanPrompt,
  retryNote,
} from "./prompts";
import { checkpointExercisesSchema, planSchema, portalPlanSchema, type Plan } from "./schemas";
import type { CheckpointSource, Journey } from "./types";

// Генерация путешествия: план (шаг 1), затем упражнения всех чекпоинтов
// параллельно (шаг 2). Между шагами сервер раскладывает типы упражнений
// по чекпоинтам (layout.ts). Каждый ответ модели проверяется схемой и правилами
// build.ts; если не прошёл — шаг повторяется один раз с объяснением, что не так.
// Повторяется только неудачный шаг: сбой одного чекпоинта не переделывает остальные.
// Одно негодное упражнение чекпоинта повтора не требует: его заменяет запасное.

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

// Один шаг с повтором. accept возвращает значение или текст ошибки (уйдёт модели при повторе);
// lastAttempt — последняя попытка: проверка может принять с оговоркой то, что раньше вернула бы
async function runStep<T, R>(
  ask: AskModel,
  step: ModelStep,
  request: Parameters<AskModel>[1] & { schema: z.ZodType<T> },
  accept: (value: T, lastAttempt: boolean) => { ok: true; value: R } | { ok: false; error: string; log?: string },
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
    const accepted = accept(result.data, attempt === ATTEMPTS);
    if (accepted.ok) return accepted;
    // В лог — log, если он есть: в error бывает текст модели (вопросы для переформулировки)
    console.error(`[journey] ${describeStep(step)}, попытка ${attempt}: ${accepted.log ?? accepted.error}`);
    prompt = request.prompt + retryNote(accepted.error);
  }
  return { ok: false, reason: "invalid-output" };
}

function describeStep(step: ModelStep): string {
  return step.kind === "plan" ? "план" : `чекпоинт ${step.number}`;
}

// Проверенный план; sources — источники чекпоинтов по порядку (только по материалам портала)
export type PlannedJourney = { plan: Plan; sources: CheckpointSource[][] | null };

export type PlanResult =
  | { ok: true; value: PlannedJourney }
  | { ok: false; reason: ModelFailure }
  | { ok: false; reason: "unsuitable"; message: string };

// Шаг 1 — план. source — своя тема или текст, PortalMaterial — разделы статей портала по теме:
// у такого плана свой промпт и схема с номерами фрагментов, а номера проверяет сервер
// (checkPortalPlan). Отдельно от упражнений — для замера плана (scripts/journey-eval.ts)
export async function planJourney(
  source: string | PortalMaterial,
  ask: AskModel = askModel,
  abortSignal?: AbortSignal,
): Promise<PlanResult> {
  const request = { timeoutMs: PLAN_TIMEOUT_MS, maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS, abortSignal };
  const plan =
    typeof source === "string"
      ? await runStep(
          ask,
          { kind: "plan" },
          { ...request, schema: planSchema, system: PLAN_SYSTEM, prompt: planPrompt(source) },
          (value): { ok: true; value: PlannedJourney } | { ok: false; error: string } => {
            // Неподходящий материал — не ошибка модели, повторять не нужно
            if (!value.suitable) return { ok: true, value: { plan: value, sources: null } };
            const error = checkPlan(value);
            return error ? { ok: false, error } : { ok: true, value: { plan: value, sources: null } };
          },
        )
      : await runStep(
          ask,
          { kind: "plan" },
          {
            ...request,
            schema: portalPlanSchema,
            system: PORTAL_PLAN_SYSTEM,
            prompt: portalPlanPrompt(source.topic, source.fragments),
          },
          (value): { ok: true; value: PlannedJourney } | { ok: false; error: string } => {
            if (!value.suitable) return { ok: true, value: { plan: { ...value, doubts: [] }, sources: null } };
            const checked = checkPortalPlan(value, source);
            if (!checked.ok) return checked;
            const error = checkPlan(checked.value.plan);
            return error ? { ok: false, error } : { ok: true, value: checked.value };
          },
        );
  if (!plan.ok) return plan;
  if (!plan.value.plan.suitable) {
    const message = plan.value.plan.problem.trim().slice(0, 300);
    return {
      ok: false,
      reason: "unsuitable",
      message: message || "По этому материалу не получается составить путешествие.",
    };
  }
  return plan;
}

// signal — отмена извне: посетитель закрыл страницу, не дождавшись путешествия
export async function generateJourney(
  source: string | PortalMaterial,
  ask: AskModel = askModel,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  // Общая отмена всех запросов: и извне, и когда один чекпоинт окончательно
  // не получился — тогда остальные дорабатывать незачем, путешествия всё равно не будет
  const controller = new AbortController();
  const abortSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  const planned = await planJourney(source, ask, abortSignal);
  if (!planned.ok) return planned;
  const { plan, sources } = planned.value;

  // Типы упражнений по чекпоинтам раскладывает сервер по отметкам плана
  const layouts = layoutJourney(plan.checkpoints);

  // Причина первого окончательного сбоя: остальные чекпоинты после него
  // отменяются и «падают» уже из-за отмены
  let failure: ModelFailure | null = null;
  const steps = await Promise.all(
    plan.checkpoints.map(async (planned, index) => {
      const step = await runStep(
        ask,
        { kind: "checkpoint", number: index + 1 },
        {
          schema: checkpointExercisesSchema,
          system: EXERCISES_SYSTEM,
          prompt: exercisesPrompt(plan, planned, layouts[index], index + 1),
          timeoutMs: EXERCISES_TIMEOUT_MS,
          maxOutputTokens: EXERCISES_MAX_OUTPUT_TOKENS,
          abortSignal,
        },
        (value, lastAttempt) => {
          const built = buildCheckpoint(planned, layouts[index], index + 1, value, lastAttempt);
          if (!built.ok) return built;
          for (const note of built.value.notes) console.warn(`[journey] чекпоинт ${index + 1}: ${note}`);
          if (built.value.replaced) console.warn(`[journey] чекпоинт ${index + 1}: ${built.value.replaced}`);
          return { ok: true, value: built.value.checkpoint };
        },
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
      title: plan.title.trim(),
      createdAt: new Date().toISOString(),
      ...(sources && { origin: "portal" as const }),
      doubts: buildDoubts(plan),
      checkpoints: steps.flatMap((step, index) =>
        step.ok ? [sources ? { ...step.value, sources: sources[index] } : step.value] : [],
      ),
    },
  };
}
