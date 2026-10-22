import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  CalibrationExercise,
  CalibrationJudgement,
  FreeAnswerExercise,
  FreeAnswerFeedback,
} from "@/lib/exercises/types";
import { generateStructured, type ModelFailure, type ModelResult } from "@/lib/llm/client";
import {
  CALIBRATION_JUDGE_SYSTEM,
  JUDGE_SYSTEM,
  calibrationJudgePrompt,
  judgePrompt,
  retryNote,
} from "./prompts";
import { sealValue, unsealValue } from "./seal";

// Оценка ответов моделью: свободного ответа и калибровки уверенности.
// Свободный ответ: модель решает по каждому критерию «выполнен или нет» и пишет короткий отзыв.
// Калибровка: по каждому вопросу «верно или нет» и отзыв; отметок уверенности модель не видит.
// Балл из этого считает сервер (handlers/freeAnswer.ts, handlers/calibration.ts) —
// число модель не выбирает. Ответ пользователя передаётся между метками со случайной
// частью (prompts.ts), поэтому для модели это данные, а не инструкции. Даже если
// инъекция удастся, она изменит только оценку и отзыв, которые видит сам автор ответа.
//
// Готовая оценка свободного ответа запечатывается и уходит в браузер вместе с итогом:
// по кнопке «Показать ответ» сервер берёт её, а не спрашивает модель снова — это не тратит
// запрос, и разбор совпадает с итогом, который человек уже видел. У калибровки попытка
// одна и разбор приходит сразу, запечатывать нечего.

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

// Схема ответа модели для калибровки: по элементу на вопрос; item — номер вопроса (с 1)
export const calibrationJudgeSchema = z.object({
  items: z.array(z.object({ item: z.number(), correct: z.boolean(), feedback: z.string() })),
});

export type CalibrationJudgeOutput = z.infer<typeof calibrationJudgeSchema>;

// Запрос к модели-оценщику. exercise и answer — для сохранённых ответов (fixtures.ts):
// answer — текст свободного ответа, у калибровки — ответы на вопросы через перевод строки
export type AskJudge = <T>(request: {
  exercise: FreeAnswerExercise | CalibrationExercise;
  answer: string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  timeoutMs: number;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
}) => Promise<ModelResult<T>>;

// Настоящий запрос к модели
export const askJudge: AskJudge = (request) => generateStructured(request);

type Judged<T> = { ok: true; evaluation: T[] } | { ok: false; reason: ModelFailure };
export type JudgeResult = Judged<FreeAnswerFeedback>;
export type CalibrationJudgeResult = Judged<CalibrationJudgement>;

// Оценивает свободный ответ
export function judgeAnswer(
  exercise: FreeAnswerExercise,
  answer: string,
  ask: AskJudge = askJudge,
  abortSignal?: AbortSignal,
): Promise<JudgeResult> {
  return runJudge(
    ask,
    {
      exercise,
      answer,
      schema: judgeSchema,
      system: JUDGE_SYSTEM,
      prompt: judgePrompt(exercise, answer),
      abortSignal,
    },
    (output) => {
      const error = checkNumbered(
        output.criteria.map(({ criterion, feedback }) => ({ number: criterion, feedback })),
        exercise.criteria.length,
        { list: "criteria", number: "criterion", what: "критерий", whose: "критериев" },
      );
      if (error) return { ok: false, error };
      return {
        ok: true,
        evaluation: [...output.criteria]
          .sort((a, b) => a.criterion - b.criterion)
          .map(({ met, feedback }) => ({ met, feedback: feedback.trim() })),
      };
    },
  );
}

// Оценивает ответы калибровки; texts — ответы в порядке вопросов
export function judgeCalibration(
  exercise: CalibrationExercise,
  texts: string[],
  ask: AskJudge = askJudge,
  abortSignal?: AbortSignal,
): Promise<CalibrationJudgeResult> {
  return runJudge(
    ask,
    {
      exercise,
      answer: texts.join("\n"),
      schema: calibrationJudgeSchema,
      system: CALIBRATION_JUDGE_SYSTEM,
      prompt: calibrationJudgePrompt(exercise, texts),
      abortSignal,
    },
    (output) => {
      const error = checkNumbered(
        output.items.map(({ item, feedback }) => ({ number: item, feedback })),
        exercise.items.length,
        { list: "items", number: "item", what: "вопрос", whose: "вопросов" },
      );
      if (error) return { ok: false, error };
      return {
        ok: true,
        evaluation: [...output.items]
          .sort((a, b) => a.item - b.item)
          .map(({ correct, feedback }) => ({ correct, feedback: feedback.trim() })),
      };
    },
  );
}

// Запрос к оценщику с повтором: если ответ модели не прошёл схему или проверку — один повтор
// с объяснением, что не так (как при генерации). accept проверяет ответ и упорядочивает оценку
async function runJudge<T, E>(
  ask: AskJudge,
  request: {
    exercise: FreeAnswerExercise | CalibrationExercise;
    answer: string;
    schema: z.ZodType<T>;
    system: string;
    prompt: string;
    abortSignal?: AbortSignal;
  },
  accept: (output: T) => { ok: true; evaluation: E[] } | { ok: false; error: string },
): Promise<Judged<E>> {
  const { exercise, abortSignal } = request;
  let prompt = request.prompt;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (abortSignal?.aborted) return { ok: false, reason: "unavailable" };
    const result = await ask({
      ...request,
      prompt,
      timeoutMs: JUDGE_TIMEOUT_MS,
      maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
    });
    if (!result.ok) {
      if (result.reason !== "invalid-output") return result;
      console.error(`[judge] ${exercise.id}, попытка ${attempt}: ответ не по схеме`);
      prompt = request.prompt + retryNote(null);
      continue;
    }
    const accepted = accept(result.data);
    if (accepted.ok) return accepted;
    console.error(`[judge] ${exercise.id}, попытка ${attempt}: ${accepted.error}`);
    prompt = request.prompt + retryNote(accepted.error);
  }
  return { ok: false, reason: "invalid-output" };
}

// Проверка ответа модели: ровно по элементу на каждый критерий (вопрос), номера с 1
// без повторов, отзыв — непустое короткое предложение. Возвращает текст ошибки
// (уйдёт модели при повторе) или null. names — как поля и элементы называются в схеме
function checkNumbered(
  items: { number: number; feedback: string }[],
  count: number,
  names: { list: string; number: string; what: string; whose: string },
): string | null {
  if (items.length !== count) {
    return `в ${names.list} нужно ровно ${count} элемента — по одному на каждый ${names.what}`;
  }
  const numbers = items.map((item) => item.number).sort((a, b) => a - b);
  if (!numbers.every((number, index) => number === index + 1)) {
    return `${names.number} — целые номера ${names.whose} от 1 до ${count}, каждый по одному разу`;
  }
  if (items.some(({ feedback }) => feedback.trim() === "")) return "пустой feedback";
  if (items.some(({ feedback }) => feedback.length > MAX_FEEDBACK_LENGTH)) {
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
