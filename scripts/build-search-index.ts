// Скрипт индексации: npm run search:index
// Нарезает статьи и упражнения на фрагменты, считает эмбеддинги и пишет
// lib/search/search-index.json. Индекс коммитится в репозиторий: сайт при работе
// эмбеддинги фрагментов не считает, только эмбеддинг вопроса.
// Пересчитываются только фрагменты с изменившимся хешем текста. Если в индексе другая
// модель эмбеддингов или длина вектора — пересчёт всего: векторы разных моделей несравнимы.
// Настройки — из .env.local, как у сайта: AI_BASE_URL, AI_API_KEY, AI_EMBEDDING_MODEL.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { buildChunkSources } from "@/lib/search/chunks";
import {
  describeEmbeddingError,
  EMBEDDING_DIMENSIONS,
  embedTexts,
  readEmbeddingConfig,
} from "@/lib/search/embeddings";
import { INDEX_PATH, serializeIndex } from "@/lib/search/indexFile";
import type { IndexedChunk, SearchIndexFile } from "@/lib/search/types";

// Сколько фрагментов отправлять в одном запросе к сервису эмбеддингов: у сервиса
// лимит запросов в минуту, поэтому весь индекс (около 50 фрагментов) — одним запросом
const BATCH_SIZE = 64;
const BATCH_TIMEOUT_MS = 60_000;

async function main() {
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
  const config = readEmbeddingConfig();
  if (!config) {
    console.error(
      "Индекс не обновлён: нужны AI_BASE_URL, AI_API_KEY и AI_EMBEDDING_MODEL в .env.local " +
        "(образец — .env.example). Без них сайт ищет только по словам по уже собранному индексу.",
    );
    process.exit(1);
  }

  const sources = buildChunkSources();
  const previous: SearchIndexFile | null = existsSync(INDEX_PATH)
    ? (JSON.parse(readFileSync(INDEX_PATH, "utf8")) as SearchIndexFile)
    : null;
  const sameModel = previous?.model === config.model && previous?.dimensions === EMBEDDING_DIMENSIONS;
  if (previous && !sameModel) {
    console.log(
      `В индексе модель ${previous.model ?? "—"} (${previous.dimensions ?? "—"}), ` +
        `теперь ${config.model} (${EMBEDDING_DIMENSIONS}) — пересчитываю все фрагменты.`,
    );
  }

  // Готовые векторы по хешу текста: фрагмент с тем же текстом не пересчитывается.
  // Вектор другой длины (записан до того, как вектор стал обрезаться) — пересчитывается
  const known = new Map<string, number[]>();
  if (sameModel) {
    for (const chunk of previous!.chunks) {
      if (chunk.embedding?.length === EMBEDDING_DIMENSIONS) known.set(chunk.hash, chunk.embedding);
    }
  }

  // Заголовки разделов «Статья › Раздел» (кроме вступления) — свои векторы, по тексту заголовка
  if (sameModel) {
    for (const chunk of previous!.chunks) {
      if (chunk.headingEmbedding?.length === EMBEDDING_DIMENSIONS) known.set(headingKey(chunk.path), chunk.headingEmbedding);
    }
  }
  const items = [
    ...sources.map((chunk) => ({ key: chunk.hash, text: chunk.text })),
    ...sources.filter(hasHeading).map((chunk) => ({ key: headingKey(chunk.path), text: chunk.path.join(" › ") })),
  ];
  const changed = items.filter((item) => !known.has(item.key));
  for (let start = 0; start < changed.length; start += BATCH_SIZE) {
    const batch = changed.slice(start, start + BATCH_SIZE);
    try {
      const vectors = await embedTexts(
        config,
        batch.map((item) => item.text),
        { timeoutMs: BATCH_TIMEOUT_MS },
      );
      batch.forEach((item, i) => known.set(item.key, vectors[i].map(round)));
    } catch (error) {
      console.error(`Индекс не обновлён: сервис эмбеддингов ответил ошибкой — ${describeEmbeddingError(error)}`);
      process.exit(1);
    }
  }

  const chunks: IndexedChunk[] = sources.map((chunk) => ({
    ...chunk,
    embedding: known.get(chunk.hash)!,
    ...(hasHeading(chunk) && { headingEmbedding: known.get(headingKey(chunk.path))! }),
  }));
  const index: SearchIndexFile = { model: config.model, dimensions: EMBEDDING_DIMENSIONS, chunks };
  const text = serializeIndex(index);
  writeFileSync(INDEX_PATH, text, "utf8");

  const removed = previous ? previous.chunks.filter((c) => !sources.some((s) => s.hash === c.hash)).length : 0;
  console.log(
    `Фрагментов: ${chunks.length} (разделов ${chunks.filter((c) => c.kind === "section").length}, ` +
      `упражнений ${chunks.filter((c) => c.kind === "exercise").length}). ` +
      `Пересчитано векторов (вместе с заголовками разделов): ${changed.length}, без изменений: ${items.length - changed.length}, ` +
      `ушло из индекса: ${removed}. Файл: ${(Buffer.byteLength(text) / 1024).toFixed(0)} КБ.`,
  );
}

// Заголовок есть у раздела, кроме вступления: заголовок вступления — название статьи,
// и оно близко к любому вопросу о её теме
const hasHeading = (chunk: { kind: string; sectionId: string }) => chunk.kind === "section" && chunk.sectionId !== "";
const headingKey = (path: string[]) => `heading:${path.join(" › ")}`;

// Пять знаков после запятой: у нормированного вектора этого хватает для сравнения,
// а файл индекса вдвое меньше
function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

main();
