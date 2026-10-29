// Замер путешествия по материалам портала: npm run journey:eval -- [--topics] [--set имя] [--prompt] [--dry] [--raw] [--own] [--full] [--record имя]
// Наборы — scripts/journey-eval-sets.json.
// --topics — подбор фрагментов без модели ответа: какие разделы находятся по каждой теме
//   списка topics и с какой близостью (одним запросом к сервису эмбеддингов на все темы).
// --set имя — материал набора (тема и сводка прогресса, как в запросе POST /api/journey; у набора
//   с article — разделы этой статьи без поиска, как у «Путешествия по этой статье»)
//   и только шаг плана на настоящей модели: время, расход токенов, план с источниками
//   и проверка номеров. --prompt печатает и сам промпт, --dry — без запроса к модели,
//   --raw — ответы модели по попыткам (и отклонённые), --own — для сравнения тот же шаг плана
//   по теме набора как по своей теме (прежний промпт).
// --full — полная генерация (план и упражнения всех чекпоинтов — 4–6 запросов к модели);
//   с --record имя ответы модели записываются сохранёнными ответами lib/journey/fixtures/<имя>.json
//   (описание потом уточняется руками).
// Нужны настройки модели и эмбеддингов в .env.local.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { LanguageModelUsage } from "ai";
import { generateStructured } from "@/lib/llm/client";
import { recordingModel, type Fixture } from "@/lib/journey/fixtures";
import { generateJourney, planJourney, type AskModel } from "@/lib/journey/generate";
import { articlePortalMaterial, findPortalMaterial, PORTAL_SECTIONS, type PortalMaterial } from "@/lib/journey/portal";
import { PORTAL_PLAN_SYSTEM, portalPlanPrompt } from "@/lib/journey/prompts";
import { embedTexts, QUERY_INSTRUCTION, readEmbeddingConfig } from "@/lib/search/embeddings";
import { MIN_SIMILARITY, rankSemantic } from "@/lib/search/rank";
import { parseSearchContext } from "@/lib/search/request";

type EvalSets = {
  topics: string[];
  sets: Record<string, { description: string; topic: string; article?: string; progress?: unknown }>;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });
  const sets = JSON.parse(readFileSync(path.join(process.cwd(), "scripts/journey-eval-sets.json"), "utf8")) as EvalSets;
  if (flag("topics")) return topics(sets.topics);

  const name = arg("set");
  const set = name ? sets.sets[name] : undefined;
  if (!name || !set) {
    console.error(`Нужен --set. Есть: ${Object.keys(sets.sets).join(", ")}`);
    process.exit(1);
  }
  console.log(`== ${name}: ${set.description}`);
  const { progress } = parseSearchContext({ progress: set.progress }, "journey-eval");
  const byArticle = set.article ? articlePortalMaterial(set.article, set.topic, progress) : null;
  // Опечатка в article не должна молча увести замер в поиск по всем статьям
  if (set.article && !byArticle) {
    console.error(`Статьи ${set.article} нет в индексе — проверьте article набора`);
    process.exit(1);
  }
  const found = byArticle ? { ok: true as const, material: byArticle } : await findPortalMaterial(set.topic, progress);
  if (!found.ok) {
    console.log(`Материала нет: ${found.reason} — модель не вызывается`);
    return;
  }
  const { material } = found;
  printMaterial(material);
  const prompt = portalPlanPrompt(material.topic, material.fragments);
  console.log(`\nПромпт: системный ${PORTAL_PLAN_SYSTEM.length} символов, запрос ${prompt.length}`);
  if (flag("prompt")) console.log(`\n${prompt}\n`);
  if (flag("dry")) return;

  // Настоящая модель с учётом расхода по каждому запросу
  const usages: LanguageModelUsage[] = [];
  const ask: AskModel = (_step, request) => generateStructured({ ...request, onUsage: (usage) => usages.push(usage) });
  const started = Date.now();

  if (!flag("full")) {
    const attempts: Pick<Fixture, "plan" | "checkpoints"> = { plan: [], checkpoints: [] };
    // --own — для сравнения тот же шаг плана по теме набора как по своей теме (прежний промпт)
    const result = await planJourney(flag("own") ? set.topic : material, recordingModel(ask, attempts));
    // --raw — ответы модели по попыткам: прочитать и отклонённый план
    if (flag("raw")) console.log(JSON.stringify(attempts.plan, null, 2));
    printUsage(usages, started);
    if (!result.ok) {
      console.log(`План не получился: ${result.reason}${"message" in result ? ` — ${result.message}` : ""}`);
      return;
    }
    const { plan, sources } = result.value;
    console.log(`\nНазвание: ${plan.title}`);
    plan.checkpoints.forEach((checkpoint, i) => {
      console.log(`\n${i + 1}. ${checkpoint.title} (зависит от: ${checkpoint.dependsOn.join(", ") || "—"})`);
      console.log(`   Понятие: ${checkpoint.concept}`);
      console.log(`   Конспект: ${checkpoint.summary}`);
      console.log(`   Факты:\n${checkpoint.keyFacts.map((fact) => `   - ${fact}`).join("\n")}`);
      console.log(`   Заблуждения:\n${checkpoint.misconceptions.map((item) => `   - ${item}`).join("\n") || "   - нет"}`);
      console.log(`   Источники: ${(sources?.[i] ?? []).map((source) => source.path.join(" › ")).join("; ")}`);
      console.log(`   Типы: ${checkpoint.suitableTypes.join(", ")}; свободный ответ: ${checkpoint.freeAnswerKinds.join(", ") || "—"}`);
    });
    return;
  }

  const recording: Pick<Fixture, "plan" | "checkpoints"> = { plan: [], checkpoints: [] };
  const result = await generateJourney(material, recordingModel(ask, recording));
  printUsage(usages, started);
  console.log(JSON.stringify(result, null, 2));
  const record = arg("record");
  if (record) {
    const fixture: Fixture = {
      description: set.description,
      source: set.topic,
      portal: { topic: set.topic, progress: set.progress, fragments: material.fragments.map((fragment) => fragment.id) },
      ...recording,
    };
    const file = path.join(process.cwd(), "lib/journey/fixtures", `${record}.json`);
    writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`.replace(/\n/g, "\r\n"));
    console.log(`\nЗаписано: ${file}`);
  }
}

function printMaterial(material: PortalMaterial) {
  console.log(`Фрагментов: ${material.fragments.length}`);
  material.fragments.forEach((fragment, i) => {
    console.log(`[${i + 1}] ${fragment.path.join(" › ")}${fragment.review ? " — стоит повторить" : ""}`);
    for (const item of fragment.review ?? []) {
      console.log(`    ответ: ${item.answer ?? "не сохранился"}${item.errors ? `; неверно: ${item.errors}` : ""}`);
    }
  });
}

function printUsage(usages: LanguageModelUsage[], started: number) {
  const sum = (key: "inputTokens" | "outputTokens") => usages.reduce((total, usage) => total + (usage[key] ?? 0), 0);
  const reasoning = usages.reduce((total, usage) => total + (usage.outputTokenDetails?.reasoningTokens ?? 0), 0);
  console.log(
    `\nЗапросов к модели: ${usages.length}; токены: вход ${sum("inputTokens")} / выход ${sum("outputTokens")} (рассуждение ${reasoning}); ${((Date.now() - started) / 1000).toFixed(1)} с`,
  );
}

// Подбор фрагментов: близость каждого раздела к теме — как в путешествии (с заголовком),
// без порога, чтобы было видно, где он проходит
async function topics(list: string[]) {
  const config = readEmbeddingConfig();
  if (!config) {
    console.error("Нужны AI_BASE_URL, AI_API_KEY и AI_EMBEDDING_MODEL в .env.local (образец — .env.example).");
    process.exit(1);
  }
  // Те же разделы, из которых выбирает путешествие (без «Что дальше» и «Итога цикла»)
  const sections = PORTAL_SECTIONS;
  const queries = await embedTexts(config, list.map((topic) => QUERY_INSTRUCTION + topic), { timeoutMs: 60_000 });
  list.forEach((topic, n) => {
    const ranked = rankSemantic(
      sections.map((chunk) => chunk.embedding),
      queries[n],
      -Infinity,
      sections.map((chunk) => chunk.headingEmbedding),
    );
    const above = ranked.filter((item) => item.score >= MIN_SIMILARITY);
    console.log(`\n== «${topic}»: выше порога ${MIN_SIMILARITY} — ${above.length}`);
    ranked.slice(0, Math.max(above.length, 3) + 2).forEach((item, i) => {
      console.log(`${i + 1}. ${item.score.toFixed(3)} ${sections[item.index].path.join(" › ")}`);
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
