import "server-only";
import type { AskModel } from "./generate";
import dough from "./fixtures/dough.json";
import inflation from "./fixtures/inflation.json";
import photosynthesis from "./fixtures/photosynthesis.json";

// Сохранённые ответы модели: разработка и проверки без лишних запросов.
// Файл — это ответы на каждый шаг цепочки в том виде, в каком их возвращает модель:
// план и упражнения каждого чекпоинта, по попыткам. null — попытка, на которой
// модель ответила не по схеме, "unavailable" — модель была недоступна.
// Ответы проходят те же проверки и ту же сборку,
// что и настоящие, поэтому на них видно, как работают проверки и повтор.

export type Fixture = {
  description: string;
  source: string;
  plan: unknown[];
  checkpoints: unknown[][];
};

// photosynthesis — пример, составленный вручную; первая попытка упражнений
// второго чекпоинта в нём намеренно ошибочна (проверка повтора).
// inflation и dough — настоящие ответы модели по теме и по тексту; что в них
// проверяется — в поле description
export const fixtures: Record<string, Fixture> = {
  photosynthesis,
  inflation,
  dough,
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
