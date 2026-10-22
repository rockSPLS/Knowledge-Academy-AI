import "server-only";
import { randomInt } from "node:crypto";
import { validateExercise } from "@/lib/exercises/server";
import {
  CALIBRATION_ITEMS_MAX,
  CALIBRATION_ITEMS_MIN,
  FREE_ANSWER_CRITERIA_MAX,
  FREE_ANSWER_CRITERIA_MIN,
} from "@/lib/exercises/limits";
import { normalizeText } from "@/lib/exercises/text";
import type { Exercise } from "@/lib/exercises/types";
import type {
  CheckpointExercises,
  GeneratedExercise,
  GeneratedType,
  Plan,
  PlanCheckpoint,
} from "./schemas";
import type { Checkpoint, Difficulty, JourneyExercise, SourceDoubt } from "./types";

// Проверка ответов модели и сборка из них путешествия. Модель пишет только
// содержание; id, порядок показа и перемешивание задаёт этот модуль — так id
// не подсказывают ответ, а верный вариант не стоит всегда первым.
// Ошибки — короткий текст по-русски: он пишется в лог и уходит модели при повторе.

export const CHECKPOINTS_MIN = 3;
export const CHECKPOINTS_MAX = 5;
const EXERCISES_MIN = 2;
const EXERCISES_MAX = 3;
const DOUBTS_MAX = 3;
// Разных типов упражнений во всём путешествии — не меньше
const JOURNEY_TYPES_MIN = 3;
// Свободных ответов во всём путешествии — не больше: каждый занимает 2–3 минуты
// и одну-две оценки моделью (под это рассчитан лимит оценки в lib/llm/limits.ts)
export const FREE_ANSWERS_MAX = 2;
// Потолок длины любой строки в ответе модели: защита от «простыней» и зацикливания
const MAX_TEXT_LENGTH = 1500;
// Допустимый ответ в пропуске не длиннее того, что можно ввести в поле
// (схема ответа «Заполните пропуски» — до 60 символов)
const MAX_BLANK_ANSWER_LENGTH = 60;
// Калибровка — не дальше этого чекпоинта (с 1)
const CALIBRATION_LAST_CHECKPOINT = 2;
// Калибровка: правильный ответ — слово или фраза, не объяснение
const MAX_CALIBRATION_EXPECTED_LENGTH = 120;
// Задание калибровки одно и то же во всех путешествиях — его задаёт сервер, а не модель
export const CALIBRATION_QUESTION = "Ответьте своими словами — хватит фразы — и отметьте, насколько уверены";

export type BuildResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------- План ----------

// Проверяет план подходящего материала (suitable = true)
export function checkPlan(plan: Plan): string | null {
  const tooLong = findTooLongText(plan);
  if (tooLong) return tooLong;
  if (isBlank(plan.title)) return "пустое название путешествия";
  const count = plan.checkpoints.length;
  if (count < CHECKPOINTS_MIN || count > CHECKPOINTS_MAX) {
    return `должно быть от ${CHECKPOINTS_MIN} до ${CHECKPOINTS_MAX} чекпоинтов, а не ${count}`;
  }
  for (const [index, checkpoint] of plan.checkpoints.entries()) {
    const error = checkPlanCheckpoint(checkpoint, index + 1);
    if (error) return `чекпоинт ${index + 1}: ${error}`;
  }
  const types = new Set(plan.checkpoints.flatMap((checkpoint) => checkpoint.exerciseTypes));
  if (types.size < JOURNEY_TYPES_MIN) {
    return `во всём путешествии должно быть не меньше ${JOURNEY_TYPES_MIN} разных типов упражнений`;
  }
  const freeAnswers = plan.checkpoints.filter((checkpoint) =>
    checkpoint.exerciseTypes.includes("free-answer"),
  ).length;
  if (freeAnswers > FREE_ANSWERS_MAX) {
    return `free-answer — не больше чем в ${FREE_ANSWERS_MAX} чекпоинтах путешествия`;
  }
  // Свободные ответы одного путешествия — разных видов
  const kinds = plan.checkpoints
    .map((checkpoint) => checkpoint.freeAnswerKind)
    .filter((kind) => kind !== "none");
  if (new Set(kinds).size !== kinds.length) {
    return "у свободных ответов в путешествии должны быть разные виды (freeAnswerKind)";
  }
  // Калибровка — собственный тип путешествий: ровно одна в каждом. Её вывод
  // «когда вы уверены, вы правы в N из M» и связанные с ней очки есть в любом путешествии.
  // Не дальше второго чекпоинта: до неё доходит и тот, кто проходит путешествие не до конца
  const calibrations = plan.checkpoints.flatMap((checkpoint, index) =>
    checkpoint.exerciseTypes.includes("calibration") ? [index + 1] : [],
  );
  if (calibrations.length !== 1) return "calibration — ровно в одном чекпоинте путешествия";
  if (calibrations[0] > CALIBRATION_LAST_CHECKPOINT) {
    return `calibration — во втором чекпоинте (или в первом), а не в ${calibrations[0]}-м`;
  }
  return null;
}

function checkPlanCheckpoint(checkpoint: PlanCheckpoint, number: number): string | null {
  if ([checkpoint.title, checkpoint.concept, checkpoint.summary].some(isBlank)) {
    return "пустое название, понятие или конспект";
  }
  if (checkpoint.keyFacts.length < 2 || checkpoint.keyFacts.some(isBlank)) {
    return "нужно не меньше двух ключевых фактов";
  }
  const deps = checkpoint.dependsOn;
  if (!deps.every((dep) => Number.isInteger(dep) && dep >= 1 && dep < number)) {
    return "зависимости — только номера более ранних чекпоинтов";
  }
  const types = checkpoint.exerciseTypes;
  if (types.length < EXERCISES_MIN || types.length > EXERCISES_MAX) {
    return `нужно ${EXERCISES_MIN}–${EXERCISES_MAX} типа упражнений`;
  }
  if (new Set(types).size !== types.length) return "типы упражнений в чекпоинте повторяются";
  // Обе проверяют, верно ли утверждение или ответ, — в одном чекпоинте это повтор
  if (types.includes("calibration") && types.includes("true-false")) {
    return "calibration и true-false не ставятся в один чекпоинт";
  }
  // Вопросы калибровки строятся на заблуждениях — без них уверенно ошибиться не на чем
  if (types.includes("calibration") && !checkpoint.misconceptions.some((item) => !isBlank(item))) {
    return "calibration — только в чекпоинте, где в misconceptions есть заблуждение";
  }
  if (types.includes("free-answer") === (checkpoint.freeAnswerKind === "none")) {
    return "freeAnswerKind — вид свободного ответа, если в exerciseTypes есть free-answer, иначе none";
  }
  // «Объясните другу» строится на заблуждении из карточки — без него модели не на что опереться
  if (checkpoint.freeAnswerKind === "friend" && !checkpoint.misconceptions.some((item) => !isBlank(item))) {
    return "freeAnswerKind friend — только если в misconceptions есть заблуждение";
  }
  return null;
}

// Сомнительные утверждения текста: лишние отбрасываем — это пояснение, а не ошибка плана
export function buildDoubts(plan: Plan): SourceDoubt[] {
  return plan.doubts
    .filter((doubt) => !isBlank(doubt.claim) && !isBlank(doubt.note))
    .slice(0, DOUBTS_MAX)
    .map(({ claim, note }) => ({ claim: claim.trim(), note: note.trim() }));
}

// ---------- Чекпоинт ----------

export function checkpointId(number: number): string {
  return `c${number}`;
}

// Собирает чекпоинт из плана и упражнений, написанных моделью
export function buildCheckpoint(
  planned: PlanCheckpoint,
  number: number,
  generated: CheckpointExercises,
): BuildResult<Checkpoint> {
  const tooLong = findTooLongText(generated);
  if (tooLong) return { ok: false, error: tooLong };
  const list = generated.exercises;
  const plannedTypes = new Set<GeneratedType>(planned.exerciseTypes);
  if (
    list.length !== plannedTypes.size ||
    new Set(list.map((item) => item.type)).size !== list.length ||
    !list.every((item) => plannedTypes.has(item.type))
  ) {
    return {
      ok: false,
      error: `нужно ровно по одному упражнению типов: ${[...plannedTypes].join(", ")}`,
    };
  }

  const id = checkpointId(number);
  const exercises: JourneyExercise[] = [];
  for (const [index, item] of list.entries()) {
    const built = buildExercise(item, `${id}-${index + 1}`, planned);
    if (!built.ok) return { ok: false, error: `упражнение ${index + 1} (${item.type}): ${built.error}` };
    exercises.push(built.value);
  }
  // Внутри чекпоинта упражнения идут по возрастанию сложности. Порядок модели
  // при равной сложности сохраняется (сортировка устойчивая)
  exercises.sort((a, b) => a.difficulty - b.difficulty);

  return {
    ok: true,
    value: {
      id,
      title: planned.title.trim(),
      concept: planned.concept.trim(),
      summary: planned.summary.trim(),
      dependsOn: [...new Set(planned.dependsOn)].map(checkpointId),
      exercises,
    },
  };
}

// ---------- Упражнение ----------

function buildExercise(
  item: GeneratedExercise,
  id: string,
  planned: PlanCheckpoint,
): BuildResult<JourneyExercise> {
  if (![1, 2, 3].includes(item.difficulty)) return { ok: false, error: "сложность — 1, 2 или 3" };
  if ([item.hint, item.question, item.explanation].some(isBlank)) {
    return { ok: false, error: "пустая подсказка, вопрос или объяснение" };
  }
  const built = buildExerciseBody(item, id, planned);
  if (!built.ok) return built;
  // Та же проверка целостности, что у упражнений банка
  const error = validateExercise(built.value);
  if (error) return { ok: false, error };
  return {
    ok: true,
    value: {
      exercise: built.value,
      difficulty: item.difficulty as Difficulty,
      hint: item.hint.trim(),
    },
  };
}

function buildExerciseBody(
  item: GeneratedExercise,
  id: string,
  planned: PlanCheckpoint,
): BuildResult<Exercise> {
  const question = item.question.trim();
  const explanation = item.explanation.trim();
  switch (item.type) {
    case "multiple-choice": {
      const options = item.options;
      if (options.length < 3 || options.length > 5) return fail("нужно от 3 до 5 вариантов");
      if (options.some((option) => isBlank(option.text)) || hasDuplicates(options.map((o) => o.text))) {
        return fail("варианты пустые или повторяются");
      }
      const correctCount = options.filter((option) => option.correct).length;
      if (correctCount === 0 || correctCount === options.length) {
        return fail("нужен хотя бы один верный и хотя бы один неверный вариант");
      }
      // Варианты перемешиваются, id — буквы по порядку показа
      const shown = shuffle(options).map((option, index) => ({
        ...option,
        id: String.fromCharCode(97 + index),
      }));
      return ok({
        id,
        type: "multiple-choice",
        question,
        options: shown.map((option) =>
          isBlank(option.feedback)
            ? { id: option.id, text: option.text.trim() }
            : { id: option.id, text: option.text.trim(), feedback: option.feedback.trim() },
        ),
        correct: shown.filter((option) => option.correct).map((option) => option.id),
        explanation,
      });
    }

    case "true-false": {
      const statements = item.statements;
      if (statements.length < 2 || statements.length > 4) return fail("нужно от 2 до 4 утверждений");
      if (statements.some((s) => isBlank(s.text) || isBlank(s.explanation))) {
        return fail("у каждого утверждения нужны текст и объяснение");
      }
      // Иначе упражнение решается ответом «всё верно» (или «всё неверно»)
      if (statements.every((s) => s.isTrue) || statements.every((s) => !s.isTrue)) {
        return fail("нужны и верные, и неверные утверждения");
      }
      return ok({
        id,
        type: "true-false",
        question,
        // Перемешаны: модель часто ставит верные утверждения первыми
        statements: shuffle(statements).map((statement, index) => ({
          id: `s${index + 1}`,
          text: statement.text.trim(),
          isTrue: statement.isTrue,
          explanation: statement.explanation.trim(),
        })),
        explanation,
      });
    }

    case "fill-blank": {
      const blanks = item.blanks;
      if (blanks.length < 1 || blanks.length > 3) return fail("нужно от 1 до 3 пропусков");
      const blankRecord: Record<string, { accepted: string[] }> = {};
      for (const [index, blank] of blanks.entries()) {
        const accepted = [...new Set(blank.accepted.map((answer) => answer.trim()))].filter(
          (answer) => normalizeText(answer) !== "",
        );
        if (accepted.length === 0) return fail(`у пропуска ${index + 1} нет допустимых ответов`);
        if (accepted.some((answer) => answer.length > MAX_BLANK_ANSWER_LENGTH)) {
          return fail(`ответ в пропуске ${index + 1} длиннее ${MAX_BLANK_ANSWER_LENGTH} символов`);
        }
        // Пропуск [[1]] в тексте — это пропуск с id "1"
        blankRecord[String(index + 1)] = { accepted };
      }
      // Соответствие пропусков в тексте и списка пропусков проверит validateExercise
      return ok({ id, type: "fill-blank", question, text: item.text.trim(), blanks: blankRecord, explanation });
    }

    case "match-pairs": {
      const pairs = item.pairs;
      if (pairs.length < 3 || pairs.length > 6) return fail("нужно от 3 до 6 пар");
      const terms = pairs.map((pair) => pair.term);
      const definitions = pairs.map((pair) => pair.definition);
      if ([...terms, ...definitions].some(isBlank) || hasDuplicates(terms) || hasDuplicates(definitions)) {
        return fail("термины или определения пустые или повторяются");
      }
      // Термины — в порядке модели, определения — перемешаны (не в порядке терминов);
      // id определений — по порядку показа
      const shownDefinitions = shuffleChanged(pairs.map((pair, index) => ({ pairIndex: index, text: pair.definition })));
      const correct: Record<string, string> = {};
      shownDefinitions.forEach((definition, position) => {
        correct[`t${definition.pairIndex + 1}`] = `d${position + 1}`;
      });
      return ok({
        id,
        type: "match-pairs",
        question,
        terms: terms.map((term, index) => ({ id: `t${index + 1}`, text: term.trim() })),
        definitions: shownDefinitions.map((definition, position) => ({
          id: `d${position + 1}`,
          text: definition.text.trim(),
        })),
        correct,
        explanation,
      });
    }

    case "order-steps": {
      const steps = item.steps;
      if (steps.length < 3 || steps.length > 6) return fail("нужно от 3 до 6 шагов");
      if (steps.some(isBlank) || hasDuplicates(steps)) return fail("шаги пустые или повторяются");
      // Шаги перемешаны (не в верном порядке); id — по порядку показа,
      // иначе id выдавали бы верный порядок
      const shown = shuffleChanged(steps.map((text, correctIndex) => ({ text, correctIndex })));
      const withIds = shown.map((step, position) => ({ ...step, id: `s${position + 1}` }));
      const correct = [...withIds]
        .sort((a, b) => a.correctIndex - b.correctIndex)
        .map((step) => step.id);
      return ok({
        id,
        type: "order-steps",
        question,
        steps: withIds.map((step) => ({ id: step.id, text: step.text.trim() })),
        correct,
        explanation,
      });
    }

    case "free-answer": {
      const criteria = item.criteria.map((criterion) => criterion.trim());
      if (criteria.length < FREE_ANSWER_CRITERIA_MIN || criteria.length > FREE_ANSWER_CRITERIA_MAX) {
        return fail(`нужно от ${FREE_ANSWER_CRITERIA_MIN} до ${FREE_ANSWER_CRITERIA_MAX} критериев`);
      }
      if (criteria.some((criterion) => criterion === "") || hasDuplicates(criteria)) {
        return fail("критерии пустые или повторяются");
      }
      if (isBlank(item.sample)) return fail("нужен образец ответа");
      // Вид задания — из плана. checkPlan уже проверил, что он задан, — ветка ниже
      // только защита (и сужение типа), модели шага 2 эта ошибка не адресована
      const kind = planned.freeAnswerKind;
      if (kind === "none") return fail("в плане не задан вид свободного ответа");
      return ok({
        id,
        type: "free-answer",
        kind,
        question,
        criteria: criteria.map((text, index) => ({ id: `k${index + 1}`, text })),
        sample: item.sample.trim(),
        explanation,
      });
    }

    case "calibration": {
      const items = item.items;
      if (items.length < CALIBRATION_ITEMS_MIN || items.length > CALIBRATION_ITEMS_MAX) {
        return fail(`нужно от ${CALIBRATION_ITEMS_MIN} до ${CALIBRATION_ITEMS_MAX} вопросов`);
      }
      if (items.some((entry) => isBlank(entry.question) || isBlank(entry.answer))) {
        return fail("у каждого вопроса нужны question и answer");
      }
      if (hasDuplicates(items.map((entry) => entry.question))) return fail("вопросы повторяются");
      if (items.some((entry) => entry.answer.trim().length > MAX_CALIBRATION_EXPECTED_LENGTH)) {
        return fail(`answer — короткий ответ, не длиннее ${MAX_CALIBRATION_EXPECTED_LENGTH} символов`);
      }
      // Порядок вопросов — как у модели: ответы не перемешиваются, подсказывать нечему
      return ok({
        id,
        type: "calibration",
        question: CALIBRATION_QUESTION,
        items: items.map((entry, index) => ({
          id: `q${index + 1}`,
          question: entry.question.trim(),
          answer: entry.answer.trim(),
        })),
        explanation,
      });
    }
  }
}

// ---------- Вспомогательное ----------

function ok(exercise: Exercise): BuildResult<Exercise> {
  return { ok: true, value: exercise };
}

function fail(error: string): BuildResult<Exercise> {
  return { ok: false, error };
}

function isBlank(value: string): boolean {
  return value.trim() === "";
}

// Повторы с точностью до регистра, «ё/е» и пробелов
function hasDuplicates(values: string[]): boolean {
  return new Set(values.map(normalizeText)).size !== values.length;
}

// Ищет слишком длинную строку в ответе модели; возвращает текст ошибки или null
function findTooLongText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > MAX_TEXT_LENGTH ? `текст длиннее ${MAX_TEXT_LENGTH} символов` : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const error = findTooLongText(item);
      if (error) return error;
    }
    return null;
  }
  if (value !== null && typeof value === "object") return findTooLongText(Object.values(value));
  return null;
}

// Перемешивание Фишера — Йетса. randomInt — криптостойкий генератор: по видимым
// перестановкам нельзя предсказать следующие
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Перемешивает так, чтобы порядок точно отличался от исходного
// (если случайно совпал — разворачивает: при двух и более элементах порядок меняется)
function shuffleChanged<T>(items: T[]): T[] {
  const result = shuffle(items);
  return result.every((item, index) => item === items[index]) ? result.reverse() : result;
}
