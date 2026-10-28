// Замер качества поиска: npm run search:eval -- [--group tune|holdout|all] [--instruction ru|en|none] [--k 60] [--headings off]
// По набору вопросов scripts/search-eval-questions.json считает, попадает ли ожидаемый
// раздел в первую тройку: отдельно по смыслу, по словам и в сочетании. Источник «попал»,
// если в тройке есть фрагмент этого раздела — сам раздел или упражнение к нему
// (ссылка ведёт туда же). Вопросы, не относящиеся к материалам, показывают, какую близость
// дают «посторонние» вопросы — по ней выбран порог MIN_SIMILARITY.
// Нужен собранный индекс (npm run search:index) и настройки эмбеддингов в .env.local.
// Каждый запуск — один запрос к сервису эмбеддингов на все вопросы сразу.

import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { embedTexts, QUERY_INSTRUCTION, readEmbeddingConfig } from "@/lib/search/embeddings";
import { INDEX_PATH } from "@/lib/search/indexFile";
import { combine, FUSION_K, rankSemantic, rankWords, type Ranked } from "@/lib/search/rank";
import type { SearchIndexFile } from "@/lib/search/types";
import { buildWordIndex } from "@/lib/search/words";

type EvalSet = {
  questions: { group: "tune" | "holdout"; question: string; expected: string[] }[];
  offTopic: string[];
};

const INSTRUCTIONS: Record<string, string> = {
  none: "",
  en: "Instruct: Given a question about learning materials, retrieve passages that answer it\nQuery: ",
  ru: QUERY_INSTRUCTION,
};

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function main() {
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
  const config = readEmbeddingConfig();
  if (!config) {
    console.error("Нужны AI_BASE_URL, AI_API_KEY и AI_EMBEDDING_MODEL в .env.local (образец — .env.example).");
    process.exit(1);
  }
  const group = arg("group", "tune");
  const instruction = INSTRUCTIONS[arg("instruction", "ru")];
  const k = Number(arg("k", String(FUSION_K)));

  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as SearchIndexFile;
  if (index.model !== config.model) {
    console.error(`Индекс посчитан моделью ${index.model}, а в настройках ${config.model} — сначала npm run search:index`);
    process.exit(1);
  }
  const set = JSON.parse(
    readFileSync(path.join(process.cwd(), "scripts", "search-eval-questions.json"), "utf8"),
  ) as EvalSet;
  const questions = set.questions.filter((q) => group === "all" || q.group === group);

  const vectors = index.chunks.map((chunk) => chunk.embedding);
  // Без заголовков (--headings off) — как до того, как близость стала считаться и по заголовку
  const headings = arg("headings", "on") === "off" ? undefined : index.chunks.map((chunk) => chunk.headingEmbedding);
  const words = buildWordIndex(index.chunks.map((chunk) => chunk.text));
  const sectionOf = (i: number) => `${index.chunks[i].articleSlug}#${index.chunks[i].sectionId}`;
  const queryVectors = await embedTexts(
    config,
    [...questions.map((q) => q.question), ...set.offTopic].map((q) => instruction + q),
    { timeoutMs: 60_000 },
  );

  const hits = { semantic: 0, words: 0, fused: 0 };
  const topSimilarity: number[] = [];
  questions.forEach((q, n) => {
    // Без порога: в замере видно, где оказался бы нужный раздел
    const semantic = rankSemantic(vectors, queryVectors[n], -Infinity, headings);
    const byWords = rankWords(words, q.question);
    // Сочетание — как на сайте: с порогом близости
    const fused = combine(rankSemantic(vectors, queryVectors[n], undefined, headings), byWords, k);
    const top3 = (list: Ranked[]) => list.slice(0, 3).map((item) => sectionOf(item.index));
    const hit = (list: Ranked[]) => top3(list).some((section) => q.expected.includes(section));
    const marks = (["semantic", "words", "fused"] as const).map((name) => {
      const list = name === "semantic" ? semantic : name === "words" ? byWords : fused;
      if (hit(list)) hits[name]++;
      return `${name} ${hit(list) ? "✓" : "✗"}`;
    });
    topSimilarity.push(semantic[0].score);
    const place = semantic.findIndex((item) => q.expected.includes(sectionOf(item.index)));
    // Место в сочетании — сколько фрагментов нужно отдать модели, чтобы нужный раздел попал в найденные (RESULT_COUNT)
    const fusedPlace = fused.findIndex((item) => q.expected.includes(sectionOf(item.index)));
    console.log(`${q.group} | ${marks.join("  ")} | близость №1 ${semantic[0].score.toFixed(3)}, нужный раздел — место ${place + 1} (${semantic[place]?.score.toFixed(3)}), в сочетании — ${fusedPlace + 1} | ${q.question}`);
    if (!hit(fused)) console.log(`   тройка сочетания: ${top3(fused).join(", ")}`);
  });

  set.offTopic.forEach((question, n) => {
    const semantic = rankSemantic(vectors, queryVectors[questions.length + n], -Infinity, headings);
    const found = combine(rankSemantic(vectors, queryVectors[questions.length + n], undefined, headings), rankWords(words, question)).length;
    console.log(`посторонний | близость №1 ${semantic[0].score.toFixed(3)} (${sectionOf(semantic[0].index)}), слов найдено: ${rankWords(words, question).length}, сочетание нашло: ${found} | ${question}`);
  });

  const total = questions.length;
  console.log(
    `\nВопросов: ${total} (${group}), инструкция: ${arg("instruction", "ru")}, k = ${k}. ` +
      `Нужный раздел в первой тройке — по смыслу ${hits.semantic}/${total}, по словам ${hits.words}/${total}, ` +
      `сочетание ${hits.fused}/${total}. Наименьшая близость №1 у вопросов по теме: ${Math.min(...topSimilarity).toFixed(3)}.`,
  );
}

main();
