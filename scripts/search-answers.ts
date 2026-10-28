// Проверка ответов поиска на смешанном прогрессе: npm run search:answers -- [--only имя] [--record] [--prompt] [--no-progress]
// Вопросы, прогресс и путешествия — scripts/search-answer-sets.json: ошибки в статьях и два
// путешествия, одно не о языковых моделях. Каждый вопрос проходит тот же поиск и ответ, что
// POST /api/search (без лимита частоты); печатаются время, расход токенов, источники и ответ —
// его проверяют по смыслу: все ли темы названы, не тянет ли модель путешествие к языковым моделям,
// не спорит ли с фрагментами. --record записывает ответ сохранённым ответом поиска
// lib/search/fixtures/<имя>.json (описание — из набора), --prompt печатает промпт, --no-progress —
// как у нового посетителя: без прогресса и путешествий.
// Нужны настройки модели и эмбеддингов в .env.local. Каждый вопрос — один запрос к модели
// (около 4–5 тысяч токенов) и один к сервису эмбеддингов (вопрос и чекпоинты путешествий).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { LanguageModelUsage } from "ai";
import { toFixtureChunkId, type SearchFixture } from "@/lib/search/fixtures";
import { parseSearchContext } from "@/lib/search/request";
import { askAnswer, findChunks, searchAndAnswer } from "@/lib/search/search";

type AnswerSets = {
  description: string;
  progress: unknown;
  journeys: unknown;
  questions: { name: string; question: string; description: string }[];
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
  const sets = JSON.parse(
    readFileSync(path.join(process.cwd(), "scripts/search-answer-sets.json"), "utf8"),
  ) as AnswerSets;
  const only = arg("only");
  const questions = sets.questions.filter((item) => !only || item.name === only);
  if (questions.length === 0) {
    console.error(`Нет вопроса ${only}. Есть: ${sets.questions.map((item) => item.name).join(", ")}`);
    process.exit(1);
  }
  // Те же проверки и пределы, что у маршрута
  const noProgress = process.argv.includes("--no-progress");
  const { journeys, progress } = noProgress ? { journeys: [], progress: undefined } : parseSearchContext(sets, "search-answers");

  for (const item of questions) {
    let usage: LanguageModelUsage | null = null;
    let prompt = "";
    const started = Date.now();
    const found = await findChunks(item.question, undefined, journeys);
    const fixture: SearchFixture = {
      description: `Настоящий ответ модели (промпт ответа поиска, версия 3): ${item.description} ${noProgress ? "Без прогресса и путешествий — как у нового посетителя." : `${sets.description} Для повтора нужны оба путешествия набора scripts/search-answer-sets.json и тот же прогресс.`}`,
      question: item.question,
      mode: found.mode,
      chunkIds: found.chunks.map(toFixtureChunkId),
      answer: null,
    };
    const result = await searchAndAnswer({
      question: item.question,
      progress,
      found,
      ask: async (request) => {
        prompt = request.prompt;
        const answer = await askAnswer({ ...request, onUsage: (value) => (usage = value) });
        fixture.answer = answer.ok ? answer.data : answer.reason === "invalid-output" ? null : "unavailable";
        return answer;
      },
    });
    const ms = Date.now() - started;

    console.log(`\n=== ${item.name}: ${item.question}`);
    console.log(`Поиск: ${result.mode}, ${(ms / 1000).toFixed(1)} с`);
    if (usage) {
      const { inputTokens, outputTokens, outputTokenDetails } = usage as LanguageModelUsage;
      console.log(
        `Токены: вход ${inputTokens ?? "?"}, выход ${outputTokens ?? "?"} (рассуждение ${outputTokenDetails?.reasoningTokens ?? "?"}); промпт ${prompt.length} символов`,
      );
    }
    console.log(`Источники: ${result.sources.map((source) => `[${source.number}] ${source.path.join(" › ")}`).join("; ")}`);
    console.log(`В материалах: ${result.answer ? !result.notInMaterials : "—"}`);
    console.log(`Ответ: ${result.answer?.text ?? "нет"}`);
    if (process.argv.includes("--prompt") && prompt) console.log(`--- Промпт:\n${prompt}`);
    if (process.argv.includes("--record") && fixture.answer) {
      const file = path.join(process.cwd(), "lib/search/fixtures", `${item.name}.json`);
      writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`.replace(/\n/g, "\r\n"));
      console.log(`Записан ${file}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
