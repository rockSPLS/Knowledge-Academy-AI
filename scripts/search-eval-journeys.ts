// Замер поиска по сохранённым путешествиям: npm run search:eval-journeys
// Путешествия — примеры из lib/journey/fixtures/ (Фотосинтез, Тесто, Инфляция, Прививки),
// их чекпоинты становятся фрагментами так же, как на сайте (lib/search/journeys.ts), и ищутся
// вместе с фрагментами статей. Для каждого варианта хранения вектора (длина, целые числа
// или дробные) считается:
// - вопросы к путешествиям (journeyQuestions в scripts/search-eval-questions.json): нужный
//   чекпоинт в первой тройке сочетания;
// - вопросы к статьям (все группы): нужный раздел по-прежнему в первой тройке, хотя рядом
//   теперь фрагменты путешествий;
// - размер запроса поиска с 20 путешествиями (примеры по кругу).
// Нужны собранный индекс и настройки эмбеддингов в .env.local; один запрос к сервису эмбеддингов.

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { fixtures } from "@/lib/journey/fixtures";
import { embedTexts, QUERY_INSTRUCTION, readEmbeddingConfig } from "@/lib/search/embeddings";
import { INDEX_PATH } from "@/lib/search/indexFile";
import { decodeVector, encodeVector, journeyChunks, shortQuery } from "@/lib/search/journeys";
import { combine, rankSemanticParts, rankWords, type Ranked } from "@/lib/search/rank";
import type { JourneySearchInput, SearchIndexFile } from "@/lib/search/types";
import { buildWordIndex } from "@/lib/search/words";

type EvalSet = {
  questions: { question: string; expected: string[] }[];
  offTopic: string[];
  journeyQuestions: { question: string; expected: string }[];
};

// Варианты хранения вектора фрагмента путешествия: длина и целые числа (байт) или дробные
const VARIANTS = [
  { dimensions: 1024, bytes: false },
  { dimensions: 1024, bytes: true },
  { dimensions: 512, bytes: true },
  { dimensions: 256, bytes: true },
  { dimensions: 128, bytes: true },
];

async function main() {
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
  const config = readEmbeddingConfig();
  if (!config) {
    console.error("Нужны AI_BASE_URL, AI_API_KEY и AI_EMBEDDING_MODEL в .env.local (образец — .env.example).");
    process.exit(1);
  }
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as SearchIndexFile;
  const set = JSON.parse(
    readFileSync(path.join(process.cwd(), "scripts", "search-eval-questions.json"), "utf8"),
  ) as EvalSet;

  // Путешествия из примеров — в том виде, в каком их присылает браузер
  const journeys: JourneySearchInput[] = Object.entries(fixtures).map(([name, fixture]) => {
    const plan = fixture.plan.at(-1) as { title: string; checkpoints: { title: string; concept: string; summary: string }[] };
    return {
      id: name,
      title: plan.title,
      checkpoints: plan.checkpoints.map((c, i) => ({ id: String(i), title: c.title, concept: c.concept, summary: c.summary })),
    };
  });
  const chunks = journeys.flatMap((journey) => journeyChunks(journey, null));
  const journeyKey = (id: string) => id.replace(/^journey:/, "");

  const questions = [
    ...set.journeyQuestions.map((q) => q.question),
    ...set.questions.map((q) => q.question),
    ...set.offTopic,
  ];
  const vectors = await embedTexts(
    config,
    [...chunks.map((chunk) => chunk.text), ...questions.map((q) => QUERY_INSTRUCTION + q)],
    { timeoutMs: 60_000 },
  );
  const chunkVectors = vectors.slice(0, chunks.length);
  const queryVectors = vectors.slice(chunks.length);

  const siteVectors = index.chunks.map((chunk) => chunk.embedding);
  const words = buildWordIndex([...index.chunks.map((chunk) => chunk.text), ...chunks.map((chunk) => chunk.text)]);
  const keyOf = (i: number) =>
    i < index.chunks.length
      ? `${index.chunks[i].articleSlug}#${index.chunks[i].sectionId}`
      : journeyKey(chunks[i - index.chunks.length].id);

  for (const variant of VARIANTS) {
    const stored = chunkVectors.map((vector) =>
      variant.bytes ? decodeVector(encodeVector(vector, variant.dimensions), variant.dimensions)! : shortQuery(vector, variant.dimensions),
    );
    const rank = (n: number): Ranked[] =>
      combine(
        rankSemanticParts([
          { vectors: siteVectors, query: queryVectors[n] },
          { vectors: stored, query: shortQuery(queryVectors[n], variant.dimensions) },
        ]),
        rankWords(words, questions[n]),
      );
    const top3 = (list: Ranked[]) => list.slice(0, 3).map((item) => keyOf(item.index));

    // Близость вопроса к фрагментам путешествий этого варианта, без порога
    const journeySimilarity = (n: number) =>
      stored.map((vector) => vector.reduce((sum, value, i) => sum + value * shortQuery(queryVectors[n], variant.dimensions)[i], 0));

    let journeyHits = 0;
    let firstPlace = 0;
    const expectedSimilarity: number[] = [];
    const misses: string[] = [];
    set.journeyQuestions.forEach((q, n) => {
      const list = rank(n);
      const place = list.findIndex((item) => keyOf(item.index) === q.expected);
      if (list[0] && keyOf(list[0].index) === q.expected) firstPlace++;
      expectedSimilarity.push(journeySimilarity(n)[chunks.findIndex((chunk) => journeyKey(chunk.id) === q.expected)]);
      if (top3(list).includes(q.expected)) journeyHits++;
      else misses.push(`   ✗ «${q.question}» — место ${place + 1 || "нет"}, тройка: ${top3(list).join(", ")}`);
    });
    // Самый близкий фрагмент путешествия у вопросов к статьям и у посторонних вопросов:
    // ниже порога — фрагменты путешествий не мешают и не находятся случайно
    const articleJourneyMax = Math.max(...set.questions.map((_, n) => Math.max(...journeySimilarity(set.journeyQuestions.length + n))));
    const offTopicMax = set.offTopic.map((_, n) =>
      Math.max(...journeySimilarity(set.journeyQuestions.length + set.questions.length + n)).toFixed(3),
    );
    let articleHits = 0;
    set.questions.forEach((q, n) => {
      const list = rank(set.journeyQuestions.length + n);
      if (top3(list).some((key) => q.expected.includes(key))) articleHits++;
      else misses.push(`   ✗ «${q.question}» — тройка: ${top3(list).join(", ")}`);
    });

    // Размер запроса: 20 путешествий — примеры по кругу, у каждого векторы этого варианта
    const vectorText = (vector: number[]) =>
      variant.bytes ? encodeVector(vector, variant.dimensions) : JSON.stringify(shortQuery(vector, variant.dimensions));
    const twenty = Array.from({ length: 20 }, (_, i) => {
      const journey = journeys[i % journeys.length];
      const first = chunks.findIndex((chunk) => chunk.journeyId === journey.id);
      return {
        ...journey,
        id: crypto.randomUUID(),
        vectors: { model: config.model, data: journey.checkpoints.map((_, k) => vectorText(chunkVectors[first + k])) },
      };
    });
    const bytes = Buffer.byteLength(JSON.stringify({ question: "x".repeat(300), journeys: twenty }));

    console.log(
      `${variant.dimensions} ${variant.bytes ? "байт" : "дробные"}: путешествия ${journeyHits}/${set.journeyQuestions.length} (первое место ${firstPlace}), ` +
        `близость нужного чекпоинта ${Math.min(...expectedSimilarity).toFixed(3)}–${Math.max(...expectedSimilarity).toFixed(3)}, ` +
        `ближайший чекпоинт у вопросов к статьям ${articleJourneyMax.toFixed(3)}, у посторонних ${offTopicMax.join(" и ")}, ` +
        `статьи ${articleHits}/${set.questions.length}, запрос с 20 путешествиями ${(bytes / 1024).toFixed(0)} КБ`,
    );
    for (const line of misses) console.log(line);
  }
}

main();
