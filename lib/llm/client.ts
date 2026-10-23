import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
} from "ai";
import type { z } from "zod";

// Единая точка вызова языковой модели. Подходит любой провайдер с API,
// совместимым с OpenAI: адрес, ключ и модель берутся из переменных окружения
// (образец — .env.example), значений по умолчанию нет. Ответ модели проверяется zod-схемой.

const DEFAULT_TIMEOUT_MS = 60_000;
// Потолок длины ответа, токенов: модель, «зациклившаяся» на повторах, не потратит
// больше. С запасом на рассуждение у моделей, которые сначала «думают»
const DEFAULT_MAX_OUTPUT_TOKENS = 4000;

// Почему не получилось: ключ не задан / модель недоступна (сеть, ключ, лимиты
// провайдера, тайм-аут) / модель ответила не по схеме
export type ModelFailure = "not-configured" | "unavailable" | "invalid-output";

export type ModelResult<T> = { ok: true; data: T } | { ok: false; reason: ModelFailure };

// Настройки читаются при каждом вызове, а не при запуске: без них сервер
// стартует как обычно, а генерация просто сообщает, что недоступна.
// Нужны все три — без любой из них модель считается не настроенной.
// AI_REASONING_EFFORT необязательна: уровень размышлений для «рассуждающих» моделей
// (low / medium / high); не задана — параметр не отправляется, ведь не все модели его принимают
function readConfig() {
  const apiKey = process.env.AI_API_KEY?.trim();
  const baseURL = process.env.AI_BASE_URL?.trim();
  const model = process.env.AI_MODEL?.trim();
  const reasoningEffort = process.env.AI_REASONING_EFFORT?.trim().toLowerCase() || undefined;
  if (!apiKey || !baseURL || !model) return null;
  return { apiKey, baseURL, model, reasoningEffort };
}

// Запрашивает у модели ответ по zod-схеме. Не бросает исключений: ошибки
// возвращаются как { ok: false, reason } и пишутся в лог сервера без текста запроса
export async function generateStructured<T>({
  schema,
  system,
  prompt,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  abortSignal,
}: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  // Отмена запроса: посетитель закрыл страницу или запрос больше не нужен
  abortSignal?: AbortSignal;
}): Promise<ModelResult<T>> {
  const config = readConfig();
  if (!config) return { ok: false, reason: "not-configured" };

  const provider = createOpenAICompatible({
    name: "model",
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    // Схема уходит провайдеру, и он сам держит ответ в её рамках
    supportsStructuredOutputs: true,
  });

  try {
    // Временные сбои (429, 5xx) библиотека повторяет сама — по умолчанию до двух раз;
    // тайм-аут общий на все попытки
    const { output } = await generateText({
      model: provider(config.model),
      output: Output.object({ schema }),
      system,
      prompt,
      timeout: timeoutMs,
      maxOutputTokens,
      abortSignal,
      // Ключ "model" — имя провайдера выше; библиотека передаёт это как reasoning_effort
      providerOptions: config.reasoningEffort
        ? { model: { reasoningEffort: config.reasoningEffort } }
        : undefined,
    });
    return { ok: true, data: output };
  } catch (error) {
    // Запрос отменили сами — это не сбой модели, в лог не пишем
    if (abortSignal?.aborted) return { ok: false, reason: "unavailable" };
    if (NoObjectGeneratedError.isInstance(error)) {
      // finishReason показывает, обрезан ли ответ по длине (length) или модель остановилась сама
      console.error(`[model] ответ модели не подошёл под схему (finishReason: ${error.finishReason ?? "?"})`);
      return { ok: false, reason: "invalid-output" };
    }
    if (NoOutputGeneratedError.isInstance(error)) {
      // Модель ответила, но без текста: обычно «рассуждающая» модель истратила весь потолок
      // длины на скрытый черновик. Это сбой ответа, а не недоступность — его стоит повторить
      console.error("[model] модель вернула пустой ответ (часто — истратила потолок длины на рассуждение)");
      return { ok: false, reason: "invalid-output" };
    }
    console.error(`[model] модель недоступна: ${describeError(error)}`);
    return { ok: false, reason: "unavailable" };
  }
}

// Короткое описание ошибки для лога: код ответа и сообщение провайдера.
// Тело запроса (в нём текст пользователя) в лог не попадает
function describeError(error: unknown): string {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(last)) {
    return `HTTP ${last.statusCode ?? "?"}: ${last.message.slice(0, 300)}`;
  }
  if (last instanceof Error) return `${last.name}: ${last.message.slice(0, 300)}`;
  return "неизвестная ошибка";
}
