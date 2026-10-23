import type { FreeAnswerKind } from "@/lib/exercises/types";
import type { BasicType, GeneratedType, PlanCheckpoint } from "./schemas";

// Раскладка типов упражнений по чекпоинтам. План отмечает, какие типы подходят
// к содержанию каждого понятия (suitableTypes, freeAnswerKinds), — это суждение
// о самом понятии, без правил для всего путешествия. Раскладку по этим отметкам
// собирает сервер, и она всегда соблюдает правила:
// - в чекпоинте 2 упражнения разных типов;
// - калибровка ровно одна, в первом или втором чекпоинте, только там, где есть
//   заблуждение, и не вместе с «Верно или неверно»;
// - свободных ответов не больше двух, виды разные, «объясните другу» — только
//   при заблуждении;
// - «Выбор ответа» — не больше чем в половине чекпоинтов (с округлением вверх);
// - во всём путешествии не меньше трёх разных типов.
// Если подходящих типов не хватает, сервер дополняет запасными: «Верно или неверно»
// и «Выбор ответа» подходят почти любому понятию, свободный ответ «объясните» и
// «простыми словами» — тоже. Раскладка детерминирована: одни и те же отметки дают одну и ту же.
//
// У каждого чекпоинта есть и запасной тип: модель пишет одно запасное упражнение,
// и сервер подставляет его вместо основного, которое не прошло проверку (build.ts).
// Запасной тип выбран так, что подстановка вместо любого основного (кроме калибровки)
// не нарушает правил. Если такого типа нет — запасное того же типа, что одно из основных,
// и заменяет только его.

export const EXERCISES_PER_CHECKPOINT = 2;
// Свободных ответов во всём путешествии — не больше: каждый занимает 2–3 минуты
// и одну-две оценки моделью (под это рассчитан лимит оценки в lib/llm/limits.ts)
export const FREE_ANSWERS_MAX = 2;
// Калибровка — не дальше этого чекпоинта (с 1): до него доходит и тот,
// кто проходит путешествие не до конца
export const CALIBRATION_LAST_CHECKPOINT = 2;
// Разных типов упражнений во всём путешествии — не меньше
export const JOURNEY_TYPES_MIN = 3;
// Запасные типы — подходят почти любому понятию; по порядку предпочтения
const FALLBACK_TYPES: BasicType[] = ["multiple-choice", "true-false"];
const FALLBACK_KINDS: FreeAnswerKind[] = ["explain", "simple"];

export type CheckpointLayout = {
  // Типы основных упражнений
  types: GeneratedType[];
  // Вид свободного ответа, если он есть среди types
  freeAnswerKind: FreeAnswerKind | null;
  // Тип запасного упражнения; null — запасного нет
  spare: BasicType | null;
};

// «Выбор ответа» — не больше чем в половине чекпоинтов, с округлением вверх
export function multipleChoiceMax(checkpointCount: number): number {
  return Math.ceil(checkpointCount / 2);
}

export function hasMisconception(checkpoint: PlanCheckpoint): boolean {
  return checkpoint.misconceptions.some((item) => item.trim() !== "");
}

// Индекс (с 0) чекпоинта калибровки: второй, если в нём есть заблуждение, иначе первый;
// null — заблуждений нет ни в одном из двух (такой план не проходит checkPlan)
export function calibrationIndex(checkpoints: PlanCheckpoint[]): number | null {
  return [1, 0].find((index) => checkpoints[index] && hasMisconception(checkpoints[index])) ?? null;
}

// Собирает раскладку плана, который прошёл checkPlan
export function layoutJourney(checkpoints: PlanCheckpoint[]): CheckpointLayout[] {
  const count = checkpoints.length;
  const calibration = calibrationIndex(checkpoints);
  if (calibration === null) throw new Error("раскладка: негде поставить калибровку");
  const layouts: CheckpointLayout[] = checkpoints.map(() => ({ types: [], freeAnswerKind: null, spare: null }));
  const multipleChoiceLimit = multipleChoiceMax(count);
  // Сколько раз тип уже стоит в путешествии: при выборе предпочитаем более редкий
  const used = new Map<GeneratedType, number>();
  const usedKinds = new Set<FreeAnswerKind>();
  const add = (index: number, type: GeneratedType) => {
    layouts[index].types.push(type);
    used.set(type, (used.get(type) ?? 0) + 1);
  };
  const usage = (type: GeneratedType) => used.get(type) ?? 0;
  const isFull = (index: number) => layouts[index].types.length >= EXERCISES_PER_CHECKPOINT;
  // Может ли тип встать в чекпоинт: не повтор и не «Верно или неверно» рядом с калибровкой
  const fits = (index: number, type: GeneratedType) =>
    !layouts[index].types.includes(type) && !(index === calibration && type === "true-false");
  // Отметки модели — без повторов, в её порядке
  const marked = checkpoints.map((checkpoint) => [...new Set(checkpoint.suitableTypes)]);
  // Виды свободного ответа, которые допустимы в чекпоинте: «объясните другу» — только при заблуждении
  const allowedKinds = (index: number, kinds: FreeAnswerKind[]) =>
    [...new Set(kinds)].filter((kind) => kind !== "friend" || hasMisconception(checkpoints[index]));
  const freeAnswerCount = () => layouts.filter((layout) => layout.freeAnswerKind !== null).length;
  const addFreeAnswer = (index: number, kinds: FreeAnswerKind[]): boolean => {
    if (freeAnswerCount() >= FREE_ANSWERS_MAX || layouts[index].types.includes("free-answer")) return false;
    const kind = allowedKinds(index, kinds).find((item) => !usedKinds.has(item));
    if (!kind) return false;
    add(index, "free-answer");
    layouts[index].freeAnswerKind = kind;
    usedKinds.add(kind);
    return true;
  };
  // Отмеченные типы по возрастанию частоты в путешествии; при равенстве — в порядке модели
  const byUsage = (types: BasicType[]) =>
    types.map((type, order) => ({ type, order })).sort((a, b) => usage(a.type) - usage(b.type) || a.order - b.order);

  // 1. Калибровка
  add(calibration, "calibration");

  // 2. Свободные ответы — где их отметила модель. Сначала с конца путешествия: дальние
  // понятия сложнее, их важнее уметь объяснить; чекпоинт калибровки — последним,
  // чтобы два ответа своими словами не стояли в одном чекпоинте
  const freeAnswerOrder = [
    ...checkpoints.map((_, index) => index).filter((index) => index !== calibration).reverse(),
    calibration,
  ];
  for (const index of freeAnswerOrder) addFreeAnswer(index, checkpoints[index].freeAnswerKinds);

  // 3. Отмеченные типы, кроме «Выбора ответа»: он подходит почти всему и нужен
  // как запасной, а его число ограничено
  for (let index = 0; index < count; index++) {
    const options = byUsage(marked[index].filter((type) => type !== "multiple-choice" && fits(index, type)));
    for (const { type } of options) {
      if (isFull(index)) break;
      add(index, type);
    }
  }

  // Чекпоинт калибровки дополняется первым: рядом с калибровкой нельзя поставить
  // «Верно или неверно», ему подходит меньше запасных
  const fillOrder = [calibration, ...checkpoints.map((_, index) => index).filter((index) => index !== calibration)];
  // Запас ограниченных типов. «Верно или неверно» можно поставить в любой чекпоинт, кроме
  // калибровки, а «Выбор ответа» и свободный ответ ограничены. need — сколько ограниченных
  // упражнений ещё нужно чекпоинту, если «Верно или неверно» займёт свободное место
  // (added — сколько типов в нём будет добавлено сверх нынешних).
  // Запаса хватает, пока чекпоинтов не больше пяти: «Выбора ответа» ceil(N/2) и два
  // свободных ответа — не меньше N. Больше чекпоинтов — правила раскладки нужно пересмотреть
  const need = (index: number, added = 0) => {
    const missing = EXERCISES_PER_CHECKPOINT - layouts[index].types.length - added;
    if (missing <= 0) return 0;
    return fits(index, "true-false") ? missing - 1 : missing;
  };
  const multipleChoiceLeft = () => multipleChoiceLimit - usage("multiple-choice");

  // 4. Не хватает — «Выбор ответа», если его отметила модель и если после этого
  // ограниченных типов хватит остальным чекпоинтам
  for (const index of fillOrder) {
    if (isFull(index) || !marked[index].includes("multiple-choice") || !fits(index, "multiple-choice")) continue;
    if (multipleChoiceLeft() <= 0) continue;
    const needAfter = layouts.reduce((sum, _, other) => sum + need(other, other === index ? 1 : 0), 0);
    if (needAfter <= multipleChoiceLeft() - 1 + (FREE_ANSWERS_MAX - freeAnswerCount())) add(index, "multiple-choice");
  }

  // 5. Всё ещё не хватает — запасные: «Верно или неверно», «Выбор ответа», затем свободный
  // ответ (сначала виды, которые отметила модель, потом «объясните» и «простыми словами»).
  // Ограниченный тип каждый чекпоинт берёт, только если без него не обойтись, — поэтому
  // запаса хватает всем: «Выбора ответа» и свободных ответов вместе не меньше, чем чекпоинтов
  for (const index of fillOrder) {
    if (!isFull(index) && fits(index, "true-false")) add(index, "true-false");
    if (!isFull(index) && fits(index, "multiple-choice") && multipleChoiceLeft() > 0) {
      add(index, "multiple-choice");
    }
    if (!isFull(index)) addFreeAnswer(index, [...checkpoints[index].freeAnswerKinds, ...FALLBACK_KINDS]);
    // Недостижимо (см. выше); самопроверка (selfCheck.ts) проверяет это на тысячах отметок
    if (!isFull(index)) throw new Error(`раскладка: чекпоинту ${index + 1} не хватило типов`);
  }

  // 6. Запасной тип. «Выбор ответа» в запасе тоже считается к его пределу:
  // если все запасные встанут на место основных, предел не будет превышен
  let multipleChoiceTotal = usage("multiple-choice");
  for (let index = 0; index < count; index++) {
    const layout = layouts[index];
    const allowed = (type: BasicType) =>
      fits(index, type) && (type !== "multiple-choice" || multipleChoiceTotal < multipleChoiceLimit);
    const spare =
      byUsage(marked[index].filter(allowed))[0]?.type ??
      FALLBACK_TYPES.find(allowed) ??
      // Другого типа нет — запасное того же типа, что основное (заменит только его)
      (layout.types.find((type): type is BasicType => isBasic(type)) ?? null);
    layout.spare = spare;
    if (spare === "multiple-choice" && !layout.types.includes(spare)) multipleChoiceTotal++;
  }

  return layouts;
}

function isBasic(type: GeneratedType): type is BasicType {
  return type !== "free-answer" && type !== "calibration";
}

// ---------- Проверка раскладки ----------
// Независимая от layoutJourney проверка всех правил — для самопроверки (selfCheck.ts),
// в том числе для раскладок после подстановки запасных упражнений

export function checkLayout(checkpoints: PlanCheckpoint[], layouts: CheckpointLayout[]): string | null {
  if (layouts.length !== checkpoints.length) return "число чекпоинтов не совпадает с планом";
  let multipleChoice = 0;
  let calibrations = 0;
  const kinds: FreeAnswerKind[] = [];
  const all = new Set<GeneratedType>();
  for (const [index, layout] of layouts.entries()) {
    const at = `чекпоинт ${index + 1}`;
    const types = layout.types;
    if (types.length < 2 || types.length > 3) return `${at}: ${types.length} упражнений`;
    if (new Set(types).size !== types.length) return `${at}: типы повторяются`;
    types.forEach((type) => all.add(type));
    const misconception = hasMisconception(checkpoints[index]);
    if (types.includes("calibration")) {
      calibrations++;
      if (index + 1 > CALIBRATION_LAST_CHECKPOINT) return `${at}: калибровка дальше второго чекпоинта`;
      if (!misconception) return `${at}: калибровка без заблуждения`;
      if (types.includes("true-false")) return `${at}: калибровка вместе с true-false`;
    }
    if (types.includes("free-answer") !== (layout.freeAnswerKind !== null)) {
      return `${at}: вид свободного ответа не согласован с типами`;
    }
    if (layout.freeAnswerKind !== null) {
      kinds.push(layout.freeAnswerKind);
      if (layout.freeAnswerKind === "friend" && !misconception) return `${at}: friend без заблуждения`;
    }
    if (types.includes("multiple-choice")) multipleChoice++;
    if (layout.spare !== null) {
      if (layout.spare === "true-false" && types.includes("calibration")) {
        return `${at}: запасное true-false рядом с калибровкой`;
      }
      if (!types.includes(layout.spare) && layout.spare === "multiple-choice") multipleChoice++;
    }
  }
  if (calibrations !== 1) return `калибровок ${calibrations}, а не одна`;
  if (kinds.length > FREE_ANSWERS_MAX) return `свободных ответов ${kinds.length}`;
  if (new Set(kinds).size !== kinds.length) return "виды свободных ответов повторяются";
  // Запасной «Выбор ответа» считается вместе с основными — так предел соблюдён после любых подстановок
  if (multipleChoice > multipleChoiceMax(layouts.length)) {
    return `«Выбор ответа» в ${multipleChoice} чекпоинтах (с запасными)`;
  }
  if (all.size < JOURNEY_TYPES_MIN) return `разных типов ${all.size}`;
  return null;
}
