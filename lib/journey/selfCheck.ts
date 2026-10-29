import "server-only";
import { z } from "zod";
import { FREE_ANSWER_KINDS, type FreeAnswerKind } from "@/lib/exercises/types";
import { buildCheckpoint, CHECKPOINTS_MAX, CHECKPOINTS_MIN, checkPlan } from "./build";
import { fixtures, fixtureSource, replayModel, type Fixture } from "./fixtures";
import { generateJourney } from "./generate";
import { calibrationIndex, checkLayout, hasMisconception, layoutJourney, type CheckpointLayout } from "./layout";
import { articles } from "@/lib/articles";
import type { ProgressInput } from "@/lib/search/request";
import {
  articlePortalMaterial,
  checkPortalPlan,
  MAX_FRAGMENTS,
  MAX_REVIEW_FRAGMENTS,
  portalMaterialFromIds,
  reviewNumbers,
  type PortalMaterial,
} from "./portal";
import { BASIC_TYPES, checkpointExercisesSchema, planSchema, type BasicType, type GeneratedType, type Plan, type PlanCheckpoint, type PortalPlan } from "./schemas";

// Самопроверка генерации без запросов к модели — только при разработке
// (POST /api/journey/dev { selfCheck: true }):
// - раскладка на тысячах случайных отметок плана (генератор с зерном — результат
//   каждый раз один и тот же) и на крайних случаях: правила соблюдены, в том числе
//   после подстановки запасных упражнений, и одни отметки дают одну раскладку;
// - все сохранённые примеры собираются, их раскладка — ожидаемая;
// - подстановка запасного упражнения и повтор на изменённых ответах «Фотосинтеза»;
// - там же — критерии свободного ответа без русских букв и вопросы калибровки с ответом «да/нет»;
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
  await checkLanguageAndYesNo(expect);
  await checkPortalNumbers(expect);
  checkPortalMaterialAndFacts(expect);
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
  // oneOf часть провайдеров в строгом режиме не принимает (HTTP 400) — только anyOf
  const exercisesJson = JSON.stringify(z.toJSONSchema(checkpointExercisesSchema, { target: "draft-7", io: "input" }));
  expect(!exercisesJson.includes('"oneOf"'), "в JSON Schema упражнений появился oneOf");
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
  "portal-hallucinations": [
    ["true-false", "multiple-choice"],
    ["calibration", "multiple-choice"],
    ["match-pairs", "true-false"],
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

// Сколько вопросов в калибровке каждого примера
const EXPECTED_CALIBRATION_ITEMS: Record<string, number> = {
  photosynthesis: 3,
  inflation: 4,
  dough: 4,
  "portal-hallucinations": 3,
  vaccines: 4,
};

const sorted = (types: string[]) => [...types].sort().join(",");

async function checkFixtures(expect: Expect) {
  for (const [name, fixture] of Object.entries(fixtures)) {
    const result = await generateJourney(fixtureSource(fixture), replayModel(fixture));
    expect(result.ok, `пример ${name} не собрался: ${JSON.stringify(result)}`);
    if (!result.ok) continue;
    const types = result.journey.checkpoints.map((checkpoint) =>
      sorted(checkpoint.exercises.map((item) => item.exercise.type)),
    );
    const expected = (EXPECTED_TYPES[name] ?? []).map(sorted);
    expect(JSON.stringify(types) === JSON.stringify(expected), `пример ${name}: типы ${JSON.stringify(types)}`);
    // Вопрос калибровки с ответом «Нет, …» в portal-hallucinations отбрасывается: из четырёх остаётся три
    const calibrations = result.journey.checkpoints.flatMap((checkpoint) =>
      checkpoint.exercises.flatMap((item) => (item.exercise.type === "calibration" ? [item.exercise.items.length] : [])),
    );
    expect(
      JSON.stringify(calibrations) === JSON.stringify([EXPECTED_CALIBRATION_ITEMS[name]]),
      `пример ${name}: вопросов калибровки ${JSON.stringify(calibrations)}`,
    );
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

// ---------- Язык критериев и калибровка «да/нет» ----------
// Подставные ответы второго чекпоинта «Фотосинтеза» (калибровка из трёх вопросов, «Выбор
// ответа» запасным и свободный ответ): критерии без единой русской буквы — свободный ответ
// не годится и заменяется запасным, английский термин в русском критерии — годен;
// вопрос калибровки с ответом «да» или «нет» отбрасывается, если остаётся не меньше трёх; иначе
// шаг повторяется, а на последней попытке калибровка принимается как есть — и свободный ответ
// с английскими критериями тоже, если его не заменить запасным. В подставных ответах
// с одной попыткой второй нет — шаг не собирается (ответ «не по схеме»)

async function checkLanguageAndYesNo(expect: Expect) {
  const run = (attempts: Exercises[]) => {
    const fixture = photosynthesisWith(2, attempts);
    return generateJourney(fixture.source, replayModel(fixture));
  };
  const typesIn = async (attempts: Exercises[]) => {
    const result = await run(attempts);
    return result.ok
      ? sorted(result.journey.checkpoints[1].exercises.map((item) => item.exercise.type))
      : `ошибка: ${result.reason}`;
  };
  const [calibration, mc, freeAnswer] = exercisesOf(2);
  const withCriteria = (criteria: string[]) => ({ ...freeAnswer, criteria });
  const items = calibration.items as { question: string; answer: string }[];
  const withItems = (list: { question: string; answer: string }[]) => ({ ...calibration, items: list });
  const yes = { question: "Нужен ли растению свет для фотосинтеза?", answer: "Да, без света он не идёт." };
  const no = { question: "Выделяет ли лист кислород в темноте?", answer: "«Нет» — ночью он его поглощает." };

  expect(
    (await typesIn([{ exercises: [calibration, mc, withCriteria(["Mentions water as the source", "Names oxygen"])] }])) ===
      sorted(["calibration", "multiple-choice"]),
    "свободный ответ с критериями без русских букв не заменён запасным",
  );
  expect(
    (await typesIn([{ exercises: [calibration, mc, withCriteria(["Названо понятие light reactions", "Mentions oxygen"])] }])) ===
      sorted(["calibration", "free-answer"]),
    "английский термин в русском критерии должен быть годен",
  );
  // Критерии по-английски и на повторе: запасное, где оно есть, — раньше; без запасного — как есть
  const english = withCriteria(["Mentions water as the source", "Names oxygen"]);
  expect(
    (await typesIn([{ exercises: [calibration, mc, english] }, { exercises: [calibration, mc, english] }])) ===
      sorted(["calibration", "multiple-choice"]),
    "на последней попытке свободный ответ с английскими критериями должен заменяться запасным, если оно есть",
  );
  expect(
    (await typesIn([{ exercises: [calibration, english] }])) === "ошибка: invalid-output",
    "свободный ответ с английскими критериями без запасного на первой попытке должен отклоняться",
  );
  const asIsFree = await run([{ exercises: [calibration, english] }, { exercises: [calibration, english] }]);
  const freeItem = asIsFree.ok
    ? asIsFree.journey.checkpoints[1].exercises.find((item) => item.exercise.type === "free-answer")
    : undefined;
  expect(
    freeItem?.exercise.type === "free-answer" && freeItem.exercise.criteria[0]?.text === "Mentions water as the source",
    "на последней попытке свободный ответ с английскими критериями без запасного должен приниматься как есть",
  );

  // Раскладка, где запасное того же типа, что второе упражнение («Верно или неверно»): строго оно
  // свободный ответ не заменяет, а на последней попытке — заменяет, и в чекпоинте два «Верно или неверно».
  // Сборка чекпоинта напрямую: в сохранённых примерах такой раскладки нет
  const [trueFalse] = exercisesOf(1);
  const layout: CheckpointLayout = { types: ["free-answer", "true-false"], freeAnswerKind: "explain", spare: "true-false" };
  const planned = (fixtures.photosynthesis.plan.at(-1) as Plan).checkpoints[0];
  const exercises = { exercises: [english, trueFalse, { ...trueFalse, question: `${String(trueFalse.question)} (ещё раз)` }] };
  const parsed = checkpointExercisesSchema.parse(exercises);
  const first = buildCheckpoint(planned, layout, 1, parsed, false);
  const last = buildCheckpoint(planned, layout, 1, parsed, true);
  expect(!first.ok, "на первой попытке запасное того же типа не должно заменять свободный ответ");
  expect(
    last.ok && last.value.checkpoint.exercises.every((item) => item.exercise.type === "true-false") && last.value.checkpoint.exercises.length === 2,
    `на последней попытке свободный ответ должно заменять запасное «Верно или неверно»: ${JSON.stringify(last.ok ? last.value.checkpoint.exercises.map((item) => item.exercise.type) : last)}`,
  );
  const noSpare = buildCheckpoint(planned, layout, 1, checkpointExercisesSchema.parse({ exercises: [english, trueFalse] }), true);
  expect(
    noSpare.ok && noSpare.value.checkpoint.exercises.some((item) => item.exercise.type === "free-answer") && noSpare.value.notes.length === 1,
    "без запасного на последней попытке свободный ответ принимается как есть, с пометкой для лога",
  );
  // Калибровку запасное не заменяет никогда, и на последней попытке тоже
  const calibrationLayout: CheckpointLayout = { types: ["calibration", "free-answer"], freeAnswerKind: "explain", spare: "multiple-choice" };
  const withoutCalibration = buildCheckpoint(planned, calibrationLayout, 2, checkpointExercisesSchema.parse({ exercises: [mc, freeAnswer] }), true);
  expect(!withoutCalibration.ok, "без калибровки чекпоинт не собирается и на последней попытке");
  expect(
    (await typesIn([{ exercises: [withItems([...items.slice(0, 2), yes]), mc, freeAnswer] }])) === "ошибка: invalid-output",
    "калибровка из трёх вопросов с ответом «да» на первой попытке должна отклоняться",
  );
  expect(
    (await typesIn([{ exercises: [withItems([...items.slice(0, 2), yes]), mc, freeAnswer] }, { exercises: [calibration, mc, freeAnswer] }])) ===
      sorted(["calibration", "free-answer"]),
    "после калибровки с ответом «да» должен пройти повтор",
  );
  const fourth = await run([{ exercises: [withItems([...items.slice(0, 1), no, ...items.slice(1)]), mc, freeAnswer] }]);
  const kept = fourth.ok ? fourth.journey.checkpoints[1].exercises.find((item) => item.exercise.type === "calibration") : undefined;
  expect(
    kept?.exercise.type === "calibration" &&
      kept.exercise.items.length === 3 &&
      kept.exercise.items.every((item) => item.question !== no.question),
    "из четырёх вопросов калибровки вопрос с ответом «нет» должен отбрасываться",
  );
  expect(
    (await typesIn([{ exercises: [withItems([...items.slice(0, 2), yes, no]), mc, freeAnswer] }])) === "ошибка: invalid-output",
    "калибровка, где без «да/нет» остаётся меньше трёх вопросов, на первой попытке должна отклоняться",
  );
  // На последней попытке — как есть, вместе с вопросами «да/нет»
  const calibrationOf = async (attempts: Exercises[]) => {
    const result = await run(attempts);
    const found = result.ok ? result.journey.checkpoints[1].exercises.find((item) => item.exercise.type === "calibration") : undefined;
    return found?.exercise.type === "calibration" ? found.exercise.items.map((item) => item.question) : null;
  };
  const threeWithYes = withItems([...items.slice(0, 2), yes]);
  const asIsThree = await calibrationOf([{ exercises: [threeWithYes, mc, freeAnswer] }, { exercises: [threeWithYes, mc, freeAnswer] }]);
  expect(
    asIsThree?.length === 3 && asIsThree.includes(yes.question),
    `на последней попытке калибровка из трёх вопросов с «да» должна приниматься как есть: ${JSON.stringify(asIsThree)}`,
  );
  const fourWithBoth = withItems([...items.slice(0, 2), yes, no]);
  const asIsFour = await calibrationOf([{ exercises: [fourWithBoth, mc, freeAnswer] }, { exercises: [fourWithBoth, mc, freeAnswer] }]);
  expect(
    asIsFour?.length === 4,
    `на последней попытке калибровка из четырёх вопросов с «да» и «нет» должна приниматься как есть: ${JSON.stringify(asIsFour)}`,
  );
  // Калибровка с «да/нет» и английские критерии в одном чекпоинте: калибровка — как есть,
  // а свободный ответ заменяет запасное «Выбор ответа», а не принимается как есть
  const bothBad = await calibrationOf([
    { exercises: [threeWithYes, mc, english] },
    { exercises: [threeWithYes, mc, english] },
  ]);
  expect(
    bothBad?.includes(yes.question) === true &&
      (await typesIn([{ exercises: [threeWithYes, mc, english] }, { exercises: [threeWithYes, mc, english] }])) ===
        sorted(["calibration", "multiple-choice"]),
    "калибровка с «да/нет» — как есть, а свободный ответ с английскими критериями — запасным, если оно есть",
  );
  expect(
    (await typesIn([{ exercises: [withItems([...items.slice(0, 2), { question: "Что нужно растению, кроме света?", answer: "Данные о почве не нужны — нужна вода." }]), mc, freeAnswer] }])) ===
      sorted(["calibration", "free-answer"]),
    "ответ, который начинается со слова «Данные», — не «да»",
  );
}

// ---------- Номера фрагментов в плане по материалам портала ----------
// Подставные ответы — сохранённый план portal-hallucinations с чужими номерами: номер, которого
// не было среди фрагментов, не становится источником; чекпоинт без годного номера и раздел
// «стоит повторить» без своего чекпоинта — ошибка плана, и план повторяется

async function checkPortalNumbers(expect: Expect) {
  const fixture = fixtures["portal-hallucinations"];
  const material = fixture ? fixtureSource(fixture) : null;
  if (!fixture || typeof material === "string" || material === null) {
    expect(false, "нет сохранённых ответов portal-hallucinations по материалам портала");
    return;
  }
  const good = fixture.plan.at(-1) as PortalPlan;
  const clone = () => structuredClone(good);
  const base = checkPortalPlan(good, material);
  expect(base.ok, `сохранённый план portal-hallucinations не прошёл проверку: ${base.ok ? "" : base.error}`);
  if (!base.ok) return;

  const foreign = clone();
  foreign.checkpoints[0].sources = [0, 42, -1, 5.5, ...good.checkpoints[0].sources];
  const cleaned = checkPortalPlan(foreign, material);
  expect(
    cleaned.ok && JSON.stringify(cleaned.value.sources) === JSON.stringify(base.value.sources),
    "чужие номера фрагментов не должны становиться источниками",
  );

  const none = clone();
  none.checkpoints.forEach((checkpoint) => (checkpoint.sources = [0, 99]));
  expect(!checkPortalPlan(none, material).ok, "чекпоинт без годного номера должен быть ошибкой плана");

  const review = reviewNumbers(material);
  expect(review.length > 0, "в сохранённом материале нет раздела «стоит повторить»");
  // Раздел «стоит повторить» стоит в источниках своего чекпоинта вторым — код ставит его первым
  const own = good.checkpoints.findIndex((checkpoint) => review.includes(checkpoint.sources[0]));
  const other = review[0] === 1 ? 2 : 1;
  const second = clone();
  second.checkpoints[own].sources = [other, ...good.checkpoints[own].sources];
  const reordered = checkPortalPlan(second, material);
  expect(
    reordered.ok && reordered.value.sources[own][0].href === material.fragments[review[0] - 1].href,
    "раздел «стоит повторить» вторым источником должен становиться первым",
  );
  // Раздела «стоит повторить» нет ни в одном чекпоинте — ошибка плана
  const noOwn = clone();
  noOwn.checkpoints.forEach((checkpoint) => {
    const rest = checkpoint.sources.filter((n) => !review.includes(n));
    checkpoint.sources = rest.length > 0 ? rest : [other];
  });
  expect(!checkPortalPlan(noOwn, material).ok, "раздел «стоит повторить» без своего чекпоинта должен быть ошибкой плана");

  // Первая попытка — только чужие номера, повтор — годный план: путешествие собирается,
  // и все его источники — разделы из материала
  const result = await generateJourney(material, replayModel({ ...fixture, plan: [none, good] }));
  const hrefs = new Set(material.fragments.map((fragment) => fragment.href));
  expect(
    result.ok &&
      result.journey.origin === "portal" &&
      result.journey.checkpoints.every(
        (checkpoint) => (checkpoint.sources?.length ?? 0) > 0 && checkpoint.sources!.every((source) => hrefs.has(source.href)),
      ),
    "после повтора путешествие по материалам портала должно собраться с источниками из материала",
  );
}

// ---------- Материал и факты плана по материалам портала ----------
// Разделов «стоит повторить» с пометкой — не больше MAX_REVIEW_FRAGMENTS, от последних ошибок:
// при шести и больше у каждого не нашлось бы своего чекпоинта. Ключевой факт по-английски
// отбрасывается, а видимый текст (конспект) код не трогает, даже с латинской буквой в слове

function checkPortalMaterialAndFacts(expect: Expect) {
  const ids = [
    "hallucinations#chto-takoe-gallyutsinatsiya",
    "hallucinations#pochemu-oni-voznikayut",
    "hallucinations#priznaki-na-kotorye-stoit-obratit-vnimanie",
    "hallucinations#kak-proveryat",
    "prompt-structure#iz-chego-sostoit-khoroshiy-prompt",
    "prompt-structure#tipichnye-oshibki",
    "prompt-structure#chek-list-pered-otpravkoy",
    "how-llm-works#kak-rozhdaetsya-otvet",
  ];
  // Шесть тем стоит повторить; последняя ошибка — у последнего упражнения списка
  const wrong = [
    "hallucinations-definition",
    "hallucinations-cause",
    "hallucinations-red-flags",
    "hallucinations-check-source",
    "prompt-parts-pairs",
    "prompt-tips-true-false",
  ];
  const progress = {
    exercises: wrong.map((id) => ({ id, verdict: "incorrect" as const })),
    mistakes: [...wrong].reverse().map((id) => ({ id, verdict: "incorrect" as const })),
    journeyConcepts: [],
    masteredConcepts: [],
  };
  const material = portalMaterialFromIds("тема", ids.map((id) => `section:${id}`), progress);
  const marked = material.fragments.filter((fragment) => fragment.review).map((fragment) => fragment.id);
  expect(
    marked.length === MAX_REVIEW_FRAGMENTS &&
      ["tipichnye-oshibki", "iz-chego-sostoit", "kak-proveryat"].every((part) => marked.some((id) => id.includes(part))),
    `разделов с пометкой «стоит повторить» должно быть ${MAX_REVIEW_FRAGMENTS}, от последних ошибок: ${marked.join(", ")}`,
  );

  checkArticleMaterial(expect, progress);

  const fixture = fixtures["portal-hallucinations"];
  if (!fixture?.portal) return;
  const good = structuredClone(fixture.plan.at(-1) as PortalPlan);
  const facts = good.checkpoints[0].keyFacts;
  good.checkpoints[0].keyFacts = [...facts, "The model predicts the most likely continuation of text."];
  good.checkpoints[0].summary = `Hаллюцинация. ${good.checkpoints[0].summary}`;
  const checked = checkPortalPlan(good, fixtureSource(fixture) as PortalMaterial);
  expect(
    checked.ok &&
      checked.value.plan.checkpoints[0].keyFacts.length === facts.length &&
      checked.value.plan.checkpoints[0].summary === good.checkpoints[0].summary,
    "ключевой факт по-английски должен отбрасываться, а конспект — оставаться как есть",
  );
}

// «Путешествие по этой статье»: материал — разделы одной статьи без переходов, до MAX_FRAGMENTS
// (лишним первым уходит вступление), пометки «стоит повторить» — только у тем этой статьи
function checkArticleMaterial(expect: Expect, progress: ProgressInput) {
  for (const { slug } of articles) {
    const material = articlePortalMaterial(slug, "Название", progress);
    const ids = material?.fragments.map((fragment) => fragment.id) ?? [];
    expect(
      material !== null &&
        ids.length > 0 &&
        ids.length <= MAX_FRAGMENTS &&
        ids.every((id) => id.startsWith(`section:${slug}`) && !/#(chto-dalshe|itog-tsikla)$/.test(id)),
      `путешествие по статье ${slug}: разделы ${ids.join(", ")}`,
    );
  }
  // В статье о том, как работают модели, 9 разделов без перехода — вступление не идёт
  const llm = articlePortalMaterial("how-llm-works", "Название", undefined);
  expect(
    llm?.fragments.length === MAX_FRAGMENTS && llm.fragments.every((fragment) => fragment.id !== "section:how-llm-works"),
    "в путешествии по статье сверх предела первым должно уходить вступление",
  );
  // В сводке ошибки и в статье о галлюцинациях, и в статье о структуре промпта
  const marked = (articlePortalMaterial("hallucinations", "Название", progress)?.fragments ?? [])
    .filter((fragment) => fragment.review)
    .map((fragment) => fragment.id);
  expect(
    marked.length === MAX_REVIEW_FRAGMENTS && marked.every((id) => id.startsWith("section:hallucinations#")),
    `пометки «стоит повторить» в путешествии по статье — только у её тем: ${marked.join(", ")}`,
  );
  expect(articlePortalMaterial("no-such-article", "Название", progress) === null, "статьи нет — материала нет");
}
