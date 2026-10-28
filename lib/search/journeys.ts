import "server-only";
import { EMBEDDING_DIMENSIONS } from "./embeddings";
import type { JourneySearchInput } from "./types";

// Фрагменты сохранённых путешествий в поиске. Путешествия хранятся в браузере
// и приходят вместе с вопросом: фрагмент — чекпоинт (понятие и конспект). Ключевых
// фактов в нём нет: они зашифрованы вместе с ответами, и поиск подсказал бы ответы.
//
// Вектор фрагмента считает сервер и отдаёт браузеру, тот хранит его вместе
// с путешествием и присылает с каждым вопросом. Чтобы запрос при 20 путешествиях
// оставался небольшим, вектор короче, чем у фрагментов статей, и записан целыми числами
// от −127 до 127 (байт на число) в base64 — около 340 символов вместо 20 КБ.
// Длина подобрана замером (DEV_NOTES.md, итерация 2).

// Длина вектора фрагмента путешествия. Модели Qwen3-Embedding обучены так, что начало
// вектора — тоже осмысленный вектор (см. embeddings.ts); близость к вопросу считается
// по началу вектора вопроса той же длины
export const JOURNEY_DIMENSIONS = 256;

// Длина base64 у вектора: 256 байт → 344 символа
export const JOURNEY_VECTOR_BASE64_LENGTH = Math.ceil(JOURNEY_DIMENSIONS / 3) * 4;

// Фрагмент путешествия на сервере — на время одного запроса
export type JourneyChunk = {
  kind: "journey";
  // journey:<id путешествия>#<id чекпоинта>
  id: string;
  journeyId: string;
  journeyTitle: string;
  // Номер чекпоинта в путешествии, с нуля
  checkpointIndex: number;
  // [«Путешествие «название»», понятие]
  path: string[];
  // Для поиска по словам и для эмбеддинга: путь, понятие одним предложением и конспект
  text: string;
  // Что нужно понять — одно предложение из плана путешествия; его видит модель
  concept: string;
  // Конспект — его видят модель и источник
  summary: string;
  // Нормированный вектор длины JOURNEY_DIMENSIONS; null — ещё не посчитан
  embedding: number[] | null;
};

export function journeyChunks(journey: JourneySearchInput, model: string | null): JourneyChunk[] {
  // Векторы годятся, только если посчитаны той же моделью и их столько же, сколько чекпоинтов
  const vectors =
    journey.vectors && journey.vectors.model === model && journey.vectors.data.length === journey.checkpoints.length
      ? journey.vectors.data
      : null;
  return journey.checkpoints.map((checkpoint, i) => {
    const path = [`Путешествие «${journey.title}»`, checkpoint.title];
    return {
      kind: "journey",
      id: `journey:${journey.id}#${checkpoint.id}`,
      journeyId: journey.id,
      journeyTitle: journey.title,
      checkpointIndex: i,
      path,
      text: `${path.join(" › ")}\n\n${checkpoint.concept}\n${checkpoint.summary}`,
      concept: checkpoint.concept,
      summary: checkpoint.summary,
      embedding: vectors ? decodeVector(vectors[i]) : null,
    };
  });
}

// Вектор для хранения в браузере: начало длиной JOURNEY_DIMENSIONS (другая длина — для замера), нормированное,
// каждое число — байт со знаком (масштаб — по самому большому числу без учёта знака)
export function encodeVector(vector: number[], dimensions = JOURNEY_DIMENSIONS): string {
  const head = normalize(vector.slice(0, dimensions));
  const max = Math.max(...head.map(Math.abs)) || 1;
  const bytes = Int8Array.from(head, (value) => Math.round((value / max) * 127));
  return Buffer.from(bytes.buffer).toString("base64");
}

// Обратно в нормированный вектор; null — строка не того вида (испорчена в браузере)
export function decodeVector(encoded: string, dimensions = JOURNEY_DIMENSIONS): number[] | null {
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length !== dimensions) return null;
  const bytes = new Int8Array(buffer.buffer, buffer.byteOffset, buffer.length);
  return normalize(Array.from(bytes));
}

// Начало вектора вопроса той же длины, что у фрагментов путешествий
export function shortQuery(query: number[], dimensions = JOURNEY_DIMENSIONS): number[] {
  return normalize(query.slice(0, dimensions));
}

function normalize(vector: number[]): number[] {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

// Вектор фрагмента статьи длиннее: проверка при запуске, что длины согласованы
if (JOURNEY_DIMENSIONS > EMBEDDING_DIMENSIONS) {
  throw new Error("Вектор фрагмента путешествия не может быть длиннее вектора эмбеддинга");
}
