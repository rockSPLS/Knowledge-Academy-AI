import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, embedMany, RetryError } from "ai";

// Эмбеддинги — через тот же OpenAI-совместимый сервис, что и остальные запросы
// к модели: адрес и ключ — AI_BASE_URL и AI_API_KEY, модель — AI_EMBEDDING_MODEL.
// Нужны все три; без любой из них поиск работает только по словам.
// Пользуются и сайт (эмбеддинг вопроса), и скрипт индексации (эмбеддинги фрагментов).

// Длина вектора. Модели Qwen3-Embedding обучены так, что начало вектора — тоже
// осмысленный вектор: укороченный вектор меньше весит, а ищет почти так же.
// Сервис получает параметр dimensions, но один и тот же запрос он может отдать
// разным провайдерам, и не каждый его учитывает (бывает вектор 4096). Поэтому вектор
// всегда обрезается до этой длины здесь и нормируется заново (DEV_NOTES.md, итерация 1)
export const EMBEDDING_DIMENSIONS = 1024;

// Инструкция для вопросов: модели семейства Qwen3-Embedding ищут лучше, если к вопросу
// приписана задача поиска (фрагменты индекса считаются без неё). Подобрана замером:
// с русской инструкцией посторонние вопросы дальше от материалов, чем без инструкции
// или с английской, а нужный раздел находится так же
export const QUERY_INSTRUCTION =
  "Instruct: По вопросу об учебных материалах найди фрагменты, которые на него отвечают\nQuery: ";

const QUERY_TIMEOUT_MS = 10_000;

export function readEmbeddingConfig() {
  const apiKey = process.env.AI_API_KEY?.trim();
  const baseURL = process.env.AI_BASE_URL?.trim();
  const model = process.env.AI_EMBEDDING_MODEL?.trim();
  if (!apiKey || !baseURL || !model) return null;
  return { apiKey, baseURL, model };
}

export type EmbeddingConfig = NonNullable<ReturnType<typeof readEmbeddingConfig>>;

// Векторы текстов, нормированные к длине 1 (тогда близость — просто скалярное произведение).
// Бросает исключение при ошибке сервиса: скрипт индексации останавливается,
// а поиск на сайте ловит его и ищет по словам
export async function embedTexts(
  config: EmbeddingConfig,
  values: string[],
  // maxRetries — повторы при временных сбоях и превышении лимита сервиса
  options: { abortSignal?: AbortSignal; timeoutMs?: number; maxRetries?: number } = {},
): Promise<number[][]> {
  const provider = createOpenAICompatible({
    name: "model",
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
  const { embeddings } = await embedMany({
    model: provider.embeddingModel(config.model),
    values,
    // Ключ "model" — имя провайдера выше
    providerOptions: { model: { dimensions: EMBEDDING_DIMENSIONS } },
    abortSignal: options.abortSignal
      ? AbortSignal.any([options.abortSignal, AbortSignal.timeout(options.timeoutMs ?? QUERY_TIMEOUT_MS)])
      : AbortSignal.timeout(options.timeoutMs ?? QUERY_TIMEOUT_MS),
    maxRetries: options.maxRetries,
  });
  return embeddings.map(shorten);
}

// Эмбеддинг вопроса. Без повторов: если сервис не ответил сразу (например, исчерпан
// его лимит запросов в минуту), поиск сразу идёт по словам, а не ждёт
export async function embedQuery(
  config: EmbeddingConfig,
  question: string,
  abortSignal?: AbortSignal,
): Promise<number[]> {
  const [vector] = await embedTexts(config, [QUERY_INSTRUCTION + question], { abortSignal, maxRetries: 0 });
  return vector;
}

// Начало вектора длиной EMBEDDING_DIMENSIONS, нормированное к длине 1.
// Вектор короче — другая модель или сбой сервиса: с ним близость не посчитать,
// поэтому ошибка (сайт ищет по словам, скрипт индексации останавливается)
function shorten(vector: number[]): number[] {
  if (vector.length < EMBEDDING_DIMENSIONS) {
    throw new Error(`сервис вернул вектор длины ${vector.length}, нужно не меньше ${EMBEDDING_DIMENSIONS}`);
  }
  const head = vector.slice(0, EMBEDDING_DIMENSIONS);
  const length = Math.hypot(...head) || 1;
  return head.map((value) => value / length);
}

// Короткое описание ошибки для лога: код ответа и сообщение сервиса (без текста вопроса)
export function describeEmbeddingError(error: unknown): string {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(last)) return `HTTP ${last.statusCode ?? "?"}: ${last.message.slice(0, 300)}`;
  if (last instanceof Error) return `${last.name}: ${last.message.slice(0, 300)}`;
  return "неизвестная ошибка";
}
