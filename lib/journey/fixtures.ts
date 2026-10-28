import "server-only";
import { normalizeText } from "@/lib/exercises/text";
import { parseSearchContext } from "@/lib/search/request";
import type { AskModel } from "./generate";
import { portalMaterialFromIds, type PortalMaterial } from "./portal";
import type { AskJudge } from "./judge";
import type { Journey } from "./types";
import dough from "./fixtures/dough.json";
import inflation from "./fixtures/inflation.json";
import photosynthesis from "./fixtures/photosynthesis.json";
import portalHallucinations from "./fixtures/portal-hallucinations.json";
import vaccines from "./fixtures/vaccines.json";

// Сохранённые ответы модели: разработка и проверки без лишних запросов.
// Файл — это ответы на каждый шаг цепочки в том виде, в каком их возвращает модель:
// план и упражнения каждого чекпоинта, по попыткам. null — попытка, на которой
// модель ответила не по схеме, "unavailable" — модель была недоступна.
// Ответы проходят те же проверки и ту же сборку,
// что и настоящие, поэтому на них видно, как работают проверки и повтор.
// judge — ответы оценщика свободных ответов и калибровки: на какой ответ пользователя
// что ответила модель.

export type JudgeFixture = {
  exerciseId: string;
  // Текст свободного ответа; у калибровки — ответы на вопросы через перевод строки
  answer: string;
  // Ответы модели по попыткам, как в plan и checkpoints
  responses: unknown[];
};

export type Fixture = {
  description: string;
  source: string;
  // Путешествие по материалам портала: тема, сводка прогресса и id найденных фрагментов
  // (section:<slug>#<якорь>) по порядку номеров. Материал собирается заново из индекса
  // (portalMaterialFromIds), без сервиса эмбеддингов; source тогда — та же тема
  portal?: { topic: string; progress?: unknown; fragments: string[] };
  plan: unknown[];
  checkpoints: unknown[][];
  judge?: JudgeFixture[];
};

// Материал сохранённых ответов: тема или текст — или разделы портала с пометками по сводке
export function fixtureSource(fixture: Fixture): string | PortalMaterial {
  if (!fixture.portal) return fixture.source;
  const { progress } = parseSearchContext({ progress: fixture.portal.progress }, "journey-fixture");
  return portalMaterialFromIds(fixture.portal.topic, fixture.portal.fragments, progress);
}

// photosynthesis — пример, составленный вручную; первая попытка упражнений
// второго чекпоинта в нём намеренно ошибочна (проверка повтора), а в первом
// и втором чекпоинтах есть свободные ответы с сохранёнными оценками.
// inflation, dough и vaccines — настоящие ответы модели по теме и по тексту; что в них
// проверяется — в поле description
export const fixtures: Record<string, Fixture> = {
  photosynthesis,
  inflation,
  dough,
  vaccines,
  "portal-hallucinations": portalHallucinations,
};

// «Модель», которая отвечает сохранёнными ответами по порядку попыток
export function replayModel(fixture: Fixture): AskModel {
  const used = new Map<string, number>();
  return async (step, request) => {
    const key = step.kind === "plan" ? "plan" : `checkpoint-${step.number}`;
    const attempts = step.kind === "plan" ? fixture.plan : (fixture.checkpoints[step.number - 1] ?? []);
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const attempt = attempts[index] ?? null;
    if (attempt === "unavailable") return { ok: false, reason: "unavailable" };
    const parsed = request.schema.safeParse(attempt);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "invalid-output" };
  };
}

// Обёртка над настоящей моделью: запоминает её ответы в формате Fixture
export function recordingModel(inner: AskModel, into: Pick<Fixture, "plan" | "checkpoints">): AskModel {
  return async (step, request) => {
    const result = await inner(step, request);
    const value = result.ok ? result.data : result.reason === "invalid-output" ? null : result.reason;
    if (step.kind === "plan") {
      into.plan.push(value);
    } else {
      (into.checkpoints[step.number - 1] ??= []).push(value);
    }
    return result;
  };
}

// «Оценщик», который отвечает сохранёнными оценками. Ответ пользователя сверяется
// мягко (регистр, «ё», пробелы) — построчно: у калибровки строка — ответ на один вопрос.
// На незнакомый ответ «модель недоступна» — так при разработке виден и запасной путь
export function replayJudge(fixture: Fixture): AskJudge {
  const used = new Map<string, number>();
  return async ({ exercise, answer, schema }) => {
    const entry = fixture.judge?.find(
      (item) => item.exerciseId === exercise.id && normalizeLines(item.answer) === normalizeLines(answer),
    );
    if (!entry) return { ok: false, reason: "unavailable" };
    const key = `${entry.exerciseId}\n${entry.answer}`;
    const index = used.get(key) ?? 0;
    used.set(key, index + 1);
    const attempt = entry.responses[index] ?? null;
    if (attempt === "unavailable") return { ok: false, reason: "unavailable" };
    const parsed = schema.safeParse(attempt);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: "invalid-output" };
  };
}

function normalizeLines(text: string): string {
  return text.split("\n").map(normalizeText).join("\n");
}

// Обёртка над настоящим оценщиком: запоминает его ответы в формате JudgeFixture
export function recordingJudge(inner: AskJudge, into: unknown[]): AskJudge {
  return async (request) => {
    const result = await inner(request);
    into.push(result.ok ? result.data : result.reason === "invalid-output" ? null : result.reason);
    return result;
  };
}

// Только при разработке: путешествие из сохранённых ответов оценивается по ним же,
// без запросов к модели. На опубликованном сайте — всегда настоящий оценщик
export function fixtureJudge(journey: Journey): AskJudge | null {
  if (process.env.NODE_ENV === "production" || !journey.fixture) return null;
  const fixture = fixtures[journey.fixture];
  return fixture ? replayJudge(fixture) : null;
}
