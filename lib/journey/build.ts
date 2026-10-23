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
import type { Exercise, FreeAnswerKind } from "@/lib/exercises/types";
import { calibrationIndex, type CheckpointLayout } from "./layout";
import type { CheckpointExercises, GeneratedExercise, GeneratedType, Plan, PlanCheckpoint } from "./schemas";
import type { Checkpoint, Difficulty, JourneyExercise, SourceDoubt } from "./types";

// Проверка ответов модели и сборка из них путешествия. Модель пишет только
// содержание; id, порядок показа и перемешивание задаёт этот модуль — так id
// не подсказывают ответ, а верный вариант не стоит всегда первым. Какие типы
// упражнений в каком чекпоинте, решает раскладка (layout.ts).
// Ошибки — короткий текст по-русски: он пишется в лог и уходит модели при повторе.

export const CHECKPOINTS_MIN = 3;
export const CHECKPOINTS_MAX = 5;
const DOUBTS_MAX = 3;
// Потолок длины любой строки в ответе модели: защита от «простыней» и зацикливания
const MAX_TEXT_LENGTH = 1500;
// Допустимый ответ в пропуске не длиннее того, что можно ввести в поле
// (схема ответа «Заполните пропуски» — до 60 символов)
const MAX_BLANK_ANSWER_LENGTH = 60;
// Калибровка: правильный ответ — слово или фраза, не объяснение
const MAX_CALIBRATION_EXPECTED_LENGTH = 120;
// Задание калибровки одно и то же во всех путешествиях — его задаёт сервер, а не модель
export const CALIBRATION_QUESTION = "Ответьте своими словами — хватит фразы — и отметьте, насколько уверены";

export type BuildResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------- План ----------

// Проверяет план подходящего материала (suitable = true). Типы упражнений план
// не выбирает — их раскладывает сервер (layout.ts), поэтому правил для типов здесь нет
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
  // Калибровка — в первом или втором чекпоинте, и её вопросы строятся на заблуждениях
  if (calibrationIndex(plan.checkpoints) === null) {
    return "в misconceptions первого или второго чекпоинта нужно хотя бы одно заблуждение";
  }
  return null;
}

function checkPlanCheckpoint(checkpoint: PlanCheckpoint, number: number): string | null {
  if ([checkpoint.title, checkpoint.concept, checkpoint.summary].some(isBlank)) {
    return "пустое название, понятие или конспект";
  }
  // Схема требует не меньше двух фактов; здесь — ещё и непустых
  if (checkpoint.keyFacts.filter((fact) => !isBlank(fact)).length < 2) {
    return "нужно не меньше двух ключевых фактов";
  }
  const deps = checkpoint.dependsOn;
  if (!deps.every((dep) => Number.isInteger(dep) && dep >= 1 && dep < number)) {
    return "зависимости — только номера более ранних чекпоинтов";
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

// Собранный чекпоинт; replaced — что заменено запасным упражнением (для лога), иначе null
export type BuiltCheckpoint = { checkpoint: Checkpoint; replaced: string | null };

// Собирает чекпоинт из плана, раскладки и упражнений, написанных моделью.
// Основное упражнение — первое в списке модели упражнение каждого типа раскладки,
// запасное — следующее упражнение запасного типа; остальное не используется.
// Если одно основное упражнение не прошло проверку (или его нет), на его место
// встаёт запасное — без повторного запроса. Калибровку запасное не заменяет:
// она в путешествии ровно одна. Две ошибки или негодное запасное — ошибка чекпоинта
export function buildCheckpoint(
  planned: PlanCheckpoint,
  layout: CheckpointLayout,
  number: number,
  generated: CheckpointExercises,
): BuildResult<BuiltCheckpoint> {
  // Основные — по типам раскладки, с позицией в списке модели: она задаёт порядок
  // при равной сложности
  const mains = new Map<GeneratedType, { item: GeneratedExercise; position: number }>();
  let spare: { item: GeneratedExercise; position: number } | null = null;
  for (const [position, item] of generated.exercises.entries()) {
    if (layout.types.includes(item.type) && !mains.has(item.type)) {
      mains.set(item.type, { item, position });
    } else if (item.type === layout.spare && spare === null) {
      spare = { item, position };
    }
  }

  // Слот — место основного упражнения: собранное упражнение или текст ошибки
  type Slot = { type: GeneratedType; position: number; value: JourneyExercise | null; error: string };
  const slots = layout.types.map((type): Slot => {
    const main = mains.get(type);
    const built = main ? buildExercise(main.item, layout.freeAnswerKind) : fail<JourneyExercise>("упражнения этого типа нет");
    return built.ok
      ? { type, position: main?.position ?? Infinity, value: built.value, error: "" }
      : { type, position: main?.position ?? Infinity, value: null, error: built.error };
  });

  let replaced: string | null = null;
  const failed = slots.filter((slot) => slot.value === null);
  if (failed.length > 0) {
    const slot = failed[0];
    const error = `упражнение ${slot.type}: ${slot.error}`;
    // Запасной тип другой — заменяет любое основное, кроме калибровки; тот же — только своё
    const canReplace =
      failed.length === 1 &&
      slot.type !== "calibration" &&
      layout.spare !== null &&
      (layout.spare === slot.type || !layout.types.includes(layout.spare));
    if (!canReplace || spare === null) return { ok: false, error };
    const built = buildExercise(spare.item, layout.freeAnswerKind);
    if (!built.ok) return { ok: false, error: `${error}; запасное ${layout.spare}: ${built.error}` };
    slot.value = built.value;
    // Отсутствующее основное — на месте запасного в списке модели
    if (slot.position === Infinity) slot.position = spare.position;
    replaced = `${error} — заменено запасным ${layout.spare}`;
  }

  const id = checkpointId(number);
  // id — по порядку в списке модели (не по показу), как и раньше
  const exercises = slots
    .sort((a, b) => a.position - b.position)
    .flatMap((slot) => (slot.value ? [slot.value] : []))
    .map((value, index) => ({ ...value, exercise: { ...value.exercise, id: `${id}-${index + 1}` } }));
  // Внутри чекпоинта упражнения идут по возрастанию сложности. Порядок модели
  // при равной сложности сохраняется (сортировка устойчивая)
  exercises.sort((a, b) => a.difficulty - b.difficulty);

  return {
    ok: true,
    value: {
      checkpoint: {
        id,
        title: planned.title.trim(),
        concept: planned.concept.trim(),
        summary: planned.summary.trim(),
        dependsOn: [...new Set(planned.dependsOn)].map(checkpointId),
        exercises,
      },
      replaced,
    },
  };
}

// ---------- Упражнение ----------

// id упражнению назначает buildCheckpoint, когда известен состав чекпоинта;
// freeAnswerKind — вид свободного ответа из раскладки
function buildExercise(
  item: GeneratedExercise,
  freeAnswerKind: FreeAnswerKind | null,
): BuildResult<JourneyExercise> {
  const tooLong = findTooLongText(item);
  if (tooLong) return { ok: false, error: tooLong };
  if (![1, 2, 3].includes(item.difficulty)) return { ok: false, error: "сложность — 1, 2 или 3" };
  if ([item.hint, item.question, item.explanation].some(isBlank)) {
    return { ok: false, error: "пустая подсказка, вопрос или объяснение" };
  }
  const built = buildExerciseBody(item, "", freeAnswerKind);
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
  freeAnswerKind: FreeAnswerKind | null,
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
      // Вид задания — из раскладки. Свободный ответ стоит в раскладке только вместе
      // с видом — ветка ниже лишь защита (и сужение типа)
      const kind = freeAnswerKind;
      if (kind === null) return fail("в раскладке нет вида свободного ответа");
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

function fail<T = Exercise>(error: string): BuildResult<T> {
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
