// Замер разбора ошибок: npm run review:eval -- [--set articles|journeys|all|many|one|no-mistakes|no-progress] [--prompt] [--dry] [--record имя]
// Прогоняет наборы прогресса из scripts/review-eval-sets.json через тот же разбор, что
// POST /api/review (без лимита частоты), и печатает по каждому: время, расход токенов,
// длину промпта, номера фрагментов в ответе модели и пункты с источниками. --prompt печатает
// и сам промпт. Без --set — все наборы по очереди. --dry — без запроса к модели: только темы,
// фрагменты и промпт (эмбеддинги понятий — как обычно). --record имя (с одним --set) записывает
// ответ модели сохранённым разбором lib/review/fixtures/<имя>.json — описание потом уточняется руками.
// Нужны настройки модели (и для разделов к понятиям — эмбеддингов) в .env.local. Каждый набор
// с ошибками — один настоящий запрос к модели (3–5,5 тысячи токенов) и не больше одного
// к сервису эмбеддингов; «нет прогресса» и «нет ошибок» модель не вызывают.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { LanguageModelUsage } from "ai";
import { askReview, reviewProgress } from "@/lib/review/review";
import type { ReviewMaterial } from "@/lib/review/material";
import { parseReviewContext } from "@/lib/review/request";

// Набор — как тело запроса POST /api/review (progress, journeys и journeyExercises) с описанием
type EvalSet = { description: string; progress?: unknown; journeys?: unknown; journeyExercises?: unknown };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
  const sets = JSON.parse(readFileSync(path.join(process.cwd(), "scripts/review-eval-sets.json"), "utf8")) as Record<
    string,
    EvalSet
  >;
  const only = arg("set");
  const dry = process.argv.includes("--dry");
  const record = arg("record");
  if (record && !only) {
    console.error("--record — только вместе с --set");
    process.exit(1);
  }
  const names = only ? [only] : Object.keys(sets);
  for (const name of names) {
    const set = sets[name];
    if (!set) {
      console.error(`Нет набора ${name}. Есть: ${Object.keys(sets).join(", ")}`);
      process.exit(1);
    }
    let usage: LanguageModelUsage | null = null;
    let prompt = "";
    let material: ReviewMaterial | null = null;
    let numbers: number[][] = [];
    let output: unknown = null;
    const started = Date.now();
    const result = await reviewProgress({
      // Те же проверки и пределы, что у маршрута
      ...parseReviewContext(set, "review-eval"),
      onMaterial: (value) => (material = value),
      ask: async (request) => {
        prompt = request.prompt;
        if (dry) return { ok: false, reason: "unavailable" };
        const answer = await askReview({ ...request, onUsage: (value) => (usage = value) });
        if (answer.ok) {
          numbers = answer.data.items.map((item) => item.fragments);
          output = answer.data;
        }
        return answer;
      },
    });
    const ms = Date.now() - started;
    if (record && material && output) {
      const fixture = {
        description: `Настоящий ответ модели (промпт разбора, версия 2): ${set.description}`,
        fragmentIds: (material as ReviewMaterial).fragments.map((fragment) => fragment.id),
        output,
      };
      const file = path.join(process.cwd(), "lib/review/fixtures", `${record}.json`);
      writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`.replace(/\n/g, "\r\n"));
      console.log(`Записан ${file}`);
    }

    console.log(`\n=== ${name}: ${set.description}`);
    console.log(`Итог: ${result.status}${result.status === "failed" ? ` (${result.reason})` : ""}, ${(ms / 1000).toFixed(1)} с`);
    if (usage) {
      const { inputTokens, outputTokens, outputTokenDetails } = usage as LanguageModelUsage;
      console.log(
        `Токены: вход ${inputTokens ?? "?"}, выход ${outputTokens ?? "?"} (рассуждение ${outputTokenDetails?.reasoningTokens ?? "?"}); промпт ${prompt.length} символов`,
      );
    }
    if (material) {
      const { topics, fragments } = material as ReviewMaterial;
      console.log(`Темы: ${topics.map((topic) => `${topic.title} ${JSON.stringify(topic.fragments)}`).join("; ")}`);
      console.log(`Фрагменты: ${fragments.map((fragment, i) => `[${i + 1}] ${fragment.id}`).join(", ")}`);
      console.log(`Номера в ответе модели: ${JSON.stringify(numbers)}`);
    }
    if (result.status === "done") {
      if (result.review.summary) console.log(`Вывод: ${result.review.summary}`);
      result.review.items.forEach((item, i) => {
        console.log(`${i + 1}. ${item.topic}`);
        console.log(`   В чём ошибка: ${item.mistake}`);
        console.log(`   Что повторить: ${item.review}`);
        console.log(`   Источники: ${item.sources.map((source) => source.href).join(", ")}`);
      });
    }
    if ((dry || process.argv.includes("--prompt")) && prompt) console.log(`--- Промпт:\n${prompt}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
