import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { FreeAnswerExercise, FreeAnswerFeedback } from "@/lib/exercises/types";
import { generateStructured, type ModelFailure, type ModelResult } from "@/lib/llm/client";
import { JUDGE_SYSTEM, judgePrompt, retryNote } from "./prompts";
import { sealValue, unsealValue } from "./seal";

// Оценка свободного ответа моделью. Модель решает по каждому критерию «выполнен или нет»
// и пишет короткий отзыв; балл из этого считает сервер (handlers/freeAnswer.ts) —
// число модель не выбирает. Ответ пользователя передаётся между метками со случайной
// частью (prompts.ts), поэтому для модели это данные, а не инструкции. Даже если
// инъекция удастся, она изменит только оценку и отзыв, которые видит сам автор ответа.
//
// Готовая оценка запечатывается и уходит в браузер вместе с итогом: по кнопке
// «Показать ответ» сервер берёт её, а не спрашивает модель снова — это не тратит
// запрос, и разбор совпадает с итогом, который человек уже видел.

// Тайм-аут одной попытки и потолок длины ответа. С повтором худший случай —
// около 50 секунд (maxDuration маршрута — 60 с, ожидание в браузере — 60 с)
const JUDGE_TIMEOUT_MS = 25_000;
const JUDGE_MAX_OUTPUT_TOKENS = 2000;
const ATTEMPTS = 2;
const MAX_FEEDBACK_LENGTH = 300;

// Схема ответа модели: по элементу на критерий; criterion — номер критерия (с 1).
// По номеру отзыв сопоставляется с критерием, даже если модель переставит элементы
export const judgeSchema = z.object({
  criteria: z.array(z.object({ criterion: z.number(), met: z.boolean(), feedback: z.string() })),
});

export type JudgeOutput = z.infer<typeof judgeSchema>;

// Запрос к модели-оценщику. exercise и answer — для сохранённых ответов (fixtures.ts)
export type AskJudge = (request: {
  exercise: FreeAnswerExercise;
  answer: string;
  schema: typeof judgeSchema;
  system: string;
  prompt: string;
  timeoutMs: number;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
}) => Promise<ModelResult<JudgeOutput>>;

// Настоящий запрос к модели
export const askJudge: AskJudge = (request) => generateStructured(request);

export type JudgeResult = { ok: true; evaluation: FreeAnswerFeedback[] } | { ok: false; reason: ModelFailure };

// Оценивает ответ. Если ответ модели не прошёл схему или проверку — один повтор
// с объяснением, что не так (как при генерации)
export async function judgeAnswer(
  exercise: FreeAnswerExercise,
  answer: string,
  ask: AskJudge = askJudge,
  abortSignal?: AbortSignal,
): Promise<JudgeResult> {
  const basePrompt = judgePrompt(exercise, answer);
  let prompt = basePrompt;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (abortSignal?.aborted) return { ok: false, reason: "unavailable" };
    const result = await ask({
      exercise,
      answer,
      schema: judgeSchema,
      system: JUDGE_SYSTEM,
      prompt,
      timeoutMs: JUDGE_TIMEOUT_MS,
      maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
      abortSignal,
    });
    if (!result.ok) {
      if (result.reason !== "invalid-output") return result;
      console.error(`[judge] ${exercise.id}, попытка ${attempt}: ответ не по схеме`);
      prompt = basePrompt + retryNote(null);
      continue;
    }
    const error = checkJudgement(exercise, result.data);
    if (!error) {
      return {
        ok: true,
        evaluation: [...result.data.criteria]
          .sort((a, b) => a.criterion - b.criterion)
          .map(({ met, feedback }) => ({ met, feedback: feedback.trim() })),
      };
    }
    console.error(`[judge] ${exercise.id}, попытка ${attempt}: ${error}`);
    prompt = basePrompt + retryNote(error);
  }
  return { ok: false, reason: "invalid-output" };
}

// Проверка ответа модели; возвращает текст ошибки (уйдёт модели при повторе) или null
function checkJudgement(exercise: FreeAnswerExercise, output: JudgeOutput): string | null {
  const count = exercise.criteria.length;
  if (output.criteria.length !== count) {
    return `в criteria нужно ровно ${count} элемента — по одному на каждый критерий`;
  }
  const numbers = output.criteria.map((item) => item.criterion).sort((a, b) => a - b);
  if (!numbers.every((number, index) => number === index + 1)) {
    return `criterion — целые номера критериев от 1 до ${count}, каждый по одному разу`;
  }
  if (output.criteria.some(({ feedback }) => feedback.trim() === "")) return "пустой feedback";
  if (output.criteria.some(({ feedback }) => feedback.length > MAX_FEEDBACK_LENGTH)) {
    return `feedback длиннее ${MAX_FEEDBACK_LENGTH} символов — нужно одно короткое предложение`;
  }
  return null;
}

// ---------- Запечатанная оценка ----------

// Оценка привязана к путешествию, упражнению и тексту ответа: к другому ответу
// (вторая попытка с исправленным текстом) она не подойдёт — тогда оценка новая
type EvaluationBinding = { sealedJourney: string; exerciseId: string; answer: string };

const sealedEvaluationSchema = z.object({
  binding: z.string(),
  evaluation: z.array(z.object({ met: z.boolean(), feedback: z.string() })),
});

function bindingHash({ sealedJourney, exerciseId, answer }: EvaluationBinding): string {
  return createHash("sha256")
    .update(JSON.stringify([sealedJourney, exerciseId, answer]))
    .digest("base64url");
}

export function sealEvaluation(binding: EvaluationBinding, evaluation: FreeAnswerFeedback[]): string | null {
  return sealValue("free-answer-evaluation", { binding: bindingHash(binding), evaluation });
}

// Оценка из запечатанной строки; null — строка повреждена или от другого ответа
export function openEvaluation(sealed: string, binding: EvaluationBinding): FreeAnswerFeedback[] | null {
  const parsed = sealedEvaluationSchema.safeParse(unsealValue("free-answer-evaluation", sealed));
  if (!parsed.success || parsed.data.binding !== bindingHash(binding)) return null;
  return parsed.data.evaluation;
}
