import "server-only";
import { z } from "zod";
import { FREE_ANSWER_KINDS, type FreeAnswerKind } from "@/lib/exercises/types";
import { CHECKPOINTS_MAX, CHECKPOINTS_MIN, checkPlan } from "./build";
import { fixtures, replayModel, type Fixture } from "./fixtures";
import { generateJourney } from "./generate";
import { calibrationIndex, checkLayout, hasMisconception, layoutJourney, type CheckpointLayout } from "./layout";
import { BASIC_TYPES, planSchema, type BasicType, type GeneratedType, type Plan, type PlanCheckpoint } from "./schemas";

// Самопроверка генерации без запросов к модели — только при разработке
// (POST /api/journey/dev { selfCheck: true }):
// - раскладка на тысячах случайных отметок плана (генератор с зерном — результат
//   каждый раз один и тот же) и на крайних случаях: правила соблюдены, в том числе
//   после подстановки запасных упражнений, и одни отметки дают одну раскладку;
// - все сохранённые примеры собираются, их раскладка — ожидаемая;
// - подстановка запасного упражнения и повтор на изменённых ответах «Фотосинтеза»;
// - минимум элементов в схеме плана доходит до JSON Schema, которую получает модель.

const RANDOM_CASES = 20_000;

export type SelfCheckReport = { passed: number; failures: string[] };

export async function runJourneySelfCheck(): Promise<SelfCheckReport> {
  const report: SelfCheckReport = { passed: 0, failures: [] };
  const expect = (condition: boolean, message: string) => {
    if (condition) report.passed++;
    else if (report.failures.length < 50) report.failures.push(message);
  };

  checkRandomLayouts(expect);
  checkEdgeLayouts(expect);
  checkSchema(expect);
  await checkFixtures(expect);
  await checkSpare(expect);
  return report;
}

type Expect = (condition: boolean, message: string) => void;

// ---------- Раскладка ----------

// Генератор псевдослучайных чисел с зерном (mulberry32): одинаковые случаи при каждом запуске
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickSome<T>(items: readonly T[], random: () => number): T[] {
  const picked = items.filter(() => random() < 0.45);
  // Порядок важен (он — предпочтение модели); изредка — повтор
  const shuffled = picked.map((item) => ({ item, key: random() })).sort((a, b) => a.key - b.key);
  const result = shuffled.map(({ item }) => item);
  if (result.length > 0 && random() < 0.05) result.push(result[0]);
  return result;
}

function makeCheckpoint(
  suitableTypes: BasicType[],
  freeAnswerKinds: FreeAnswerKind[],
  misconception: boolean,
): PlanCheckpoint {
  return {
    title: "Понятие",
    concept: "Что нужно понять",
    summary: "Конспект",
    keyFacts: ["Факт 1", "Факт 2"],
    // «Нет заблуждения» — и пустой список, и пустая строка (её схема не ловит)
    misconceptions: misconception ? ["Заблуждение"] : suitableTypes.length % 2 === 0 ? [] : [" "],
    dependsOn: [],
    suitableTypes,
    freeAnswerKinds,
  };
}

function describeMarks(checkpoints: PlanCheckpoint[]): string {
  return checkpoints
    .map(
      (checkpoint) =>
        `[${checkpoint.suitableTypes.join(",")} | ${checkpoint.freeAnswerKinds.join(",")} | ${hasMisconception(checkpoint) ? "з" : "-"}]`,
    )
    .join(" ");
}

// Раскладки после подстановки запасных: в каждом чекпоинте — без подстановки или запасное
// вместо одного из основных, которые оно может заменить; все сочетания по чекпоинтам
function substitutionVariants(layouts: CheckpointLayout[]): CheckpointLayout[][] {
  let variants: CheckpointLayout[][] = [[]];
  for (const layout of layouts) {
    const options: CheckpointLayout[] = [layout];
    const spare = layout.spare;
    if (spare !== null && !layout.types.includes(spare)) {
      for (const type of layout.types) {
        if (type === "calibration") continue;
        options.push({
          types: layout.types.map((item) => (item === type ? spare : item)),
          freeAnswerKind: type === "free-answer" ? null : layout.freeAnswerKind,
          spare: null,
        });
      }
    }
    variants = variants.flatMap((variant) => options.map((option) => [...variant, option]));
  }
  return variants;
}

function checkOneLayout(checkpoints: PlanCheckpoint[], expect: Expect): CheckpointLayout[] | null {
  const marks = describeMarks(checkpoints);
  if (calibrationIndex(checkpoints) === null) {
    let threw = false;
    try {
      layoutJourney(checkpoints);
    } catch {
      threw = true;
    }
    expect(threw, `без заблуждений в 1–2 чекпоинтах раскладка должна отказать: ${marks}`);
    return null;
  }
  let layouts: CheckpointLayout[];
  try {
    layouts = layoutJourney(checkpoints);
  } catch (error) {
    expect(false, `раскладка упала: ${String(error)} — ${marks}`);
    return null;
  }
  const error = checkLayout(checkpoints, layouts);
  expect(error === null, `раскладка нарушает правило «${error}»: ${marks} → ${JSON.stringify(layouts)}`);
  expect(
    JSON.stringify(layoutJourney(checkpoints)) === JSON.stringify(layouts),
    `раскладка не детерминирована: ${marks}`,
  );
  // Запасного нет, только если в чекпоинте нет ни одного базового типа (калибровка и свободный ответ)
  expect(
    layouts.every(
      (layout) => layout.spare !== null || layout.types.every((type) => type === "calibration" || type === "free-answer"),
    ),
    `в чекпоинте нет запасного, хотя его можно было назначить: ${marks}`,
  );
  for (const variant of substitutionVariants(layouts)) {
    const substituted = checkLayout(checkpoints, variant);
    if (substituted !== null) {
      expect(false, `после подстановки запасного нарушено «${substituted}»: ${marks} → ${JSON.stringify(variant)}`);
      break;
    }
  }
  // Отметки модели соблюдены: если в чекпоинте отмечено хотя бы два допустимых типа,
  // кроме «Выбора ответа», запасные основными не ставятся
  const calibration = calibrationIndex(checkpoints);
  for (const [index, checkpoint] of checkpoints.entries()) {
    const allowed = new Set(
      checkpoint.suitableTypes.filter(
        (type) => type !== "multiple-choice" && !(index === calibration && type === "true-false"),
      ),
    );
    if (allowed.size < 2) continue;
    const unmarked = layouts[index].types.filter(
      (type) => type !== "calibration" && type !== "free-answer" && !checkpoint.suitableTypes.includes(type as BasicType),
    );
    expect(unmarked.length === 0, `чекпоинт ${index + 1}: неотмеченные типы ${unmarked.join(",")} — ${marks}`);
  }
  return layouts;
}

function checkRandomLayouts(expect: Expect) {
  const random = seeded(20261023);
  for (let run = 0; run < RANDOM_CASES; run++) {
    const count = CHECKPOINTS_MIN + Math.floor(random() * (CHECKPOINTS_MAX - CHECKPOINTS_MIN + 1));
    const checkpoints = Array.from({ length: count }, () =>
      makeCheckpoint(
        pickSome(BASIC_TYPES, random),
        pickSome(FREE_ANSWER_KINDS, random),
        random() < 0.75,
      ),
    );
    checkOneLayout(checkpoints, expect);
  }
}

function checkEdgeLayouts(expect: Expect) {
  const all = [...BASIC_TYPES];
  const kinds = [...FREE_ANSWER_KINDS];
  for (let count = CHECKPOINTS_MIN; count <= CHECKPOINTS_MAX; count++) {
    const same = (types: BasicType[], freeAnswerKinds: FreeAnswerKind[], misconception = true) =>
      Array.from({ length: count }, () => makeCheckpoint(types, freeAnswerKinds, misconception));
    // Модель не отметила ничего — всё из запасных
    const empty = checkOneLayout(same([], []), expect);
    if (empty) {
      const types = new Set(empty.flatMap((layout) => layout.types));
      expect(types.has("calibration") && types.size >= 3, `пустые отметки, ${count} чекпоинтов: ${JSON.stringify(empty)}`);
    }
    checkOneLayout(same(all, kinds), expect);
    checkOneLayout(same(["multiple-choice"], []), expect);
    checkOneLayout(same(["true-false"], []), expect);
    // Заблуждение только в первом чекпоинте: калибровка в нём, «объясните другу» — нигде
    const onlyFirst = same(["true-false"], ["friend"], false);
    onlyFirst[0] = makeCheckpoint(["true-false"], ["friend"], true);
    checkOneLayout(onlyFirst, expect);
    checkOneLayout(same(["order-steps"], ["explain"]), expect);
    // Ни в первом, ни во втором чекпоинте нет заблуждения: план не проходит checkPlan
    const noMisconception = same(all, kinds).map((checkpoint, index) =>
      index < 2 ? makeCheckpoint(all, kinds, false) : checkpoint,
    );
    checkOneLayout(noMisconception, expect);
    const plan: Plan = { suitable: true, problem: "", title: "Тема", doubts: [], checkpoints: noMisconception };
    expect(checkPlan(plan) !== null, "checkPlan пропустил план без заблуждений в первых двух чекпоинтах");
  }
  // Калибровка — во втором чекпоинте, а если в нём нет заблуждения — в первом
  const second = layoutJourney([makeCheckpoint([], [], true), makeCheckpoint([], [], true), makeCheckpoint([], [], true)]);
  expect(second[1].types.includes("calibration"), "калибровка не во втором чекпоинте");
  const first = layoutJourney([makeCheckpoint([], [], true), makeCheckpoint([], [], false), makeCheckpoint([], [], true)]);
  expect(first[0].types.includes("calibration"), "калибровка не в первом чекпоинте, когда во втором нет заблуждения");
}

function checkSchema(expect: Expect) {
  // Та же настройка, с которой AI SDK превращает zod-схему в JSON Schema для модели
  const json = JSON.stringify(z.toJSONSchema(planSchema, { target: "draft-7", io: "input" }));
  expect(json.includes('"minItems":2'), "minItems не попал в JSON Schema плана");
  const checkpoint = makeCheckpoint([], [], true);
  const plan = { suitable: true, problem: "", title: "Тема", doubts: [], checkpoints: [checkpoint] };
  expect(planSchema.safeParse(plan).success, "схема плана не принимает верный план");
  expect(
    !planSchema.safeParse({ ...plan, checkpoints: [{ ...checkpoint, keyFacts: ["Один факт"] }] }).success,
    "схема плана принимает один ключевой факт",
  );
  expect(
    planSchema.safeParse({ ...plan, checkpoints: [{ ...checkpoint, misconceptions: [] }] }).success,
    "схема плана не принимает чекпоинт без заблуждений",
  );
}

// ---------- Сохранённые примеры ----------

// Типы упражнений по чекпоинтам, которые должны получиться из сохранённых ответов
const EXPECTED_TYPES: Record<string, GeneratedType[][]> = {
  photosynthesis: [
    ["true-false", "free-answer"],
    ["calibration", "free-answer"],
    ["order-steps", "match-pairs"],
  ],
  inflation: [
    ["multiple-choice", "fill-blank"],
    ["match-pairs", "calibration"],
    ["true-false", "order-steps"],
    ["match-pairs", "true-false"],
    ["multiple-choice", "match-pairs"],
  ],
  dough: [
    ["multiple-choice", "fill-blank"],
    ["calibration", "match-pairs"],
    ["true-false", "multiple-choice"],
    ["order-steps", "free-answer"],
  ],
  vaccines: [
    ["multiple-choice", "fill-blank"],
    ["calibration", "free-answer"],
    ["multiple-choice", "match-pairs"],
    ["true-false", "free-answer"],
    ["multiple-choice", "true-false"],
  ],
};

const sorted = (types: string[]) => [...types].sort().join(",");

async function checkFixtures(expect: Expect) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    const result = await generateJourney(fixture.source, replayModel(fixture));
    expect(result.ok, `пример ${name} не собрался: ${JSON.stringify(result)}`);
    if (!result.ok) continue;
    const types = result.journey.checkpoints.map((checkpoint) =>
      sorted(checkpoint.exercises.map((item) => item.exercise.type)),
    );
    const expected = (EXPECTED_TYPES[name] ?? []).map(sorted);
    expect(JSON.stringify(types) === JSON.stringify(expected), `пример ${name}: типы ${JSON.stringify(types)}`);
    // Сохранённые оценки ссылаются на упражнения, которые есть в путешествии и оцениваются ИИ
    const exercises = result.journey.checkpoints.flatMap((checkpoint) => checkpoint.exercises.map((item) => item.exercise));
    for (const judge of fixture.judge ?? []) {
      const exercise = exercises.find((item) => item.id === judge.exerciseId);
      expect(
        exercise?.type === "free-answer" || exercise?.type === "calibration",
        `пример ${name}: оценка для ${judge.exerciseId} не находит своё упражнение`,
      );
    }
  }
}

// ---------- Запасное упражнение ----------

type Exercises = { exercises: Record<string, unknown>[] };

// «Фотосинтез» с изменёнными ответами на упражнения одного чекпоинта
function photosynthesisWith(number: number, attempts: Exercises[]): Fixture {
  const base = fixtures.photosynthesis;
  const checkpoints = base.checkpoints.map((list, index) => (index === number - 1 ? attempts : list));
  return { ...base, checkpoints };
}

function exercisesOf(number: number): Record<string, unknown>[] {
  const attempts = fixtures.photosynthesis.checkpoints[number - 1] as Exercises[];
  return structuredClone(attempts[attempts.length - 1].exercises);
}

function broken(exercise: Record<string, unknown>): Record<string, unknown> {
  return { ...exercise, hint: " " };
}

async function checkSpare(expect: Expect) {
  const typesOf = async (fixture: Fixture, number: number) => {
    const result = await generateJourney(fixture.source, replayModel(fixture));
    return result.ok
      ? sorted(result.journey.checkpoints[number - 1].exercises.map((item) => item.exercise.type))
      : `ошибка: ${result.reason}`;
  };
  // Третий чекпоинт: order-steps, match-pairs и запасное true-false
  const [steps, pairs, spare] = exercisesOf(3);

  expect(
    (await typesOf(photosynthesisWith(3, [{ exercises: [steps, broken(pairs), spare] }]), 3)) ===
      sorted(["order-steps", "true-false"]),
    "негодное основное не заменено запасным",
  );
  expect(
    (await typesOf(photosynthesisWith(3, [{ exercises: [pairs, spare] }]), 3)) === sorted(["match-pairs", "true-false"]),
    "недостающее основное не заменено запасным",
  );
  expect(
    (await typesOf(photosynthesisWith(3, [{ exercises: [broken(steps), broken(pairs), spare] }]), 3)) ===
      "ошибка: invalid-output",
    "две ошибки в чекпоинте должны отклонять ответ",
  );
  expect(
    (await typesOf(photosynthesisWith(3, [{ exercises: [broken(steps), pairs, broken(spare)] }]), 3)) ===
      "ошибка: invalid-output",
    "негодное запасное не должно подставляться",
  );
  // Запасное не того типа (раскладка просит true-false, а здесь multiple-choice) не подставляется
  const [, wrongSpare] = exercisesOf(1);
  expect(
    (await typesOf(photosynthesisWith(3, [{ exercises: [broken(steps), pairs, wrongSpare] }]), 3)) ===
      "ошибка: invalid-output",
    "запасное не того типа не должно подставляться",
  );
  expect(
    (await typesOf(photosynthesisWith(3, [{ exercises: [broken(steps), pairs, spare] }, { exercises: [steps, pairs, spare] }]), 3)) ===
      sorted(["true-false", "match-pairs"]),
    "запасное должно подставляться без повтора",
  );

  // Второй чекпоинт: калибровку запасное не заменяет — нужен повтор
  const [calibration, mc, freeAnswer] = exercisesOf(2);
  expect(
    (await typesOf(photosynthesisWith(2, [{ exercises: [broken(calibration), mc, freeAnswer] }]), 2)) ===
      "ошибка: invalid-output",
    "калибровка не должна заменяться запасным",
  );
  expect(
    (await typesOf(
      photosynthesisWith(2, [{ exercises: [broken(calibration), mc, freeAnswer] }, { exercises: [calibration, mc, freeAnswer] }]),
      2,
    )) === sorted(["calibration", "free-answer"]),
    "после негодной калибровки должен пройти повтор",
  );
  // Свободный ответ заменяется запасным «Выбором ответа»
  expect(
    (await typesOf(photosynthesisWith(2, [{ exercises: [calibration, mc, broken(freeAnswer)] }]), 2)) ===
      sorted(["calibration", "multiple-choice"]),
    "свободный ответ не заменён запасным",
  );
}
