import { z } from "zod";
import { MAX_ANSWER_ITEMS, MAX_ID_LENGTH, validateItemIds } from "../limits";
import { verdictFromScore } from "../scoring";
import type {
  CheckResult,
  CostedSelectExercise,
  CostedSelectReview,
  CostedOption,
  PublicCostedSelect,
} from "../types";

// Серверная логика собственного типа «Цена выбора» (costed-select): у каждого варианта
// есть цена в токенах; нужно собрать промпт — взять нужное и не набрать «воды».
// Название описывает механику («выбор с ценой», без лимита), тексты — тему портала (промпты).
//
// «Вода» в токенах: всё, что взято из «воды»; у нужного сведения — всё сверх цены его
// самой короткой версии (полная переписка полезна ровно настолько, насколько её пересказ;
// вторая версия того же сведения — дубль целиком).
//
// Балл — доля выполненных элементов:
// - каждое нужное сведение (в любой версии);
// - «ничего опасного не отдали» — если в упражнении есть опасное;
// - «не раздуто» — «воды» в промпте нет совсем: ни лишних сведений, ни дублей, ни длинной
//   версии там, где есть краткая. Строго, потому что тип — для итоговых упражнений повышенной сложности:
//   «Верно» — только чистый промпт.
// Два последних засчитываются, только если взято не меньше трёх четвертей нужных:
// иначе «одна вода» или «одно нужное сведение» получали бы их бесплатно.
// Штраф: каждый взятый опасный вариант отнимает ещё один элемент (балл — не ниже нуля).
// Отдать модели пароль — не лишний вес, а вредное действие: два пароля хуже одного.
// Штрафы — только здесь; в выборе ответа их нет, там неверный вариант — ошибка знания.

const MIN_NEEDED_SHARE = 0.75;

export function toPublic(exercise: CostedSelectExercise): PublicCostedSelect {
  const byId = optionsById(exercise);
  return {
    id: exercise.id,
    type: exercise.type,
    question: exercise.question,
    starred: exercise.starred ?? false,
    // Только тексты и цены в порядке показа; вид сведения и пояснения — на сервере
    options: exercise.order.map((id) => {
      const { text, cost } = byId.get(id)!;
      return { id, text, cost };
    }),
  };
}

export const answerSchema = z.object({
  selected: z.array(z.string().max(MAX_ID_LENGTH)).max(MAX_ANSWER_ITEMS),
});

// Проверка целостности упражнения в банке; возвращает текст ошибки или null
export function validate(exercise: CostedSelectExercise): string | null {
  const { items, order } = exercise;
  if (items.length < 4 || items.length > 8) return "должно быть от 4 до 8 сведений";
  const optionIds = items.flatMap((item) => item.versions.map((version) => version.id));
  const idsError =
    validateItemIds(
      items.map((item) => item.id),
      "сведений",
    ) ?? validateItemIds(optionIds, "версий");
  if (idsError) return idsError;
  for (const item of items) {
    if (item.versions.length < 1 || item.versions.length > 2) {
      return `у сведения "${item.id}" должна быть одна версия или две`;
    }
    if (item.versions.some((version) => !Number.isInteger(version.cost) || version.cost <= 0)) {
      return `у сведения "${item.id}" цена версии — целое число больше нуля`;
    }
    // Иначе непонятно, какая версия краткая, и отметка «есть короче» была бы неверной
    if (item.versions.length === 2 && item.versions[0].cost === item.versions[1].cost) {
      return `у сведения "${item.id}" версии должны различаться по цене`;
    }
  }
  if (items.filter((item) => item.kind === "needed").length < 2) {
    return "нужных сведений должно быть хотя бы два";
  }
  // Порядок показа — все версии, каждая ровно один раз
  if (order.length !== optionIds.length || !optionIds.every((id) => order.includes(id))) {
    return "порядок показа должен содержать каждую версию ровно один раз";
  }
  // Версии одного сведения — вразброс: рядом они подсказывали бы, что это одно и то же
  const owner = new Map(items.flatMap((item) => item.versions.map((v) => [v.id, item.id])));
  if (order.some((id, index) => index > 0 && owner.get(order[index - 1]) === owner.get(id))) {
    return "версии одного сведения стоят рядом — разнесите их";
  }
  return null;
}

// Возвращает null, если ответ не подходит этому упражнению: ничего не выбрано
// (иначе пустой ответ получал бы баллы), неизвестный id или повтор
export function check(
  exercise: CostedSelectExercise,
  answer: z.infer<typeof answerSchema>,
): CheckResult<CostedSelectReview> | null {
  const byId = optionsById(exercise);
  const picked = new Set(answer.selected);
  if (picked.size === 0 || picked.size !== answer.selected.length) return null;
  if (![...picked].every((id) => byId.has(id))) return null;

  const options: CostedSelectReview["options"] = {};
  const composition = { useful: 0, noise: 0, danger: 0 };
  let neededTotal = 0;
  let neededIncluded = 0;
  let hasDanger = false;
  let dangerIncluded = false;
  // Сколько опасных вариантов взято — за каждый штраф
  let dangerPicked = 0;

  for (const item of exercise.items) {
    const chosen = item.versions.filter((version) => picked.has(version.id));
    // Короткая версия первой: при двух выбранных она — «нужное», длинная — дубль
    const byLength = [...item.versions].sort((a, b) => a.cost - b.cost);
    const mistake = (status: CostedSelectReview["options"][string]["status"]) =>
      item.feedback ? { status, feedback: item.feedback } : { status };

    if (item.kind === "needed") {
      neededTotal++;
      if (chosen.length === 0) {
        // Пропущено — отмечаем у самой короткой версии, остальные без отметки
        byLength.forEach((version, index) => {
          options[version.id] = index === 0 ? mistake("missed") : { status: "neutral" };
        });
        continue;
      }
      neededIncluded++;
      const shortest = byLength[0];
      const usefulPart = shortest.cost;
      composition.useful += usefulPart;
      composition.noise += sumCost(chosen) - usefulPart;
      const keeper = byLength.find((version) => picked.has(version.id))!;
      for (const version of item.versions) {
        if (!picked.has(version.id)) options[version.id] = { status: "neutral" };
        else if (version !== keeper) options[version.id] = mistake("duplicate");
        else if (version !== shortest) options[version.id] = mistake("needed-long");
        else options[version.id] = { status: "needed" };
      }
    } else if (item.kind === "noise") {
      composition.noise += sumCost(chosen);
      for (const version of item.versions) {
        options[version.id] = picked.has(version.id) ? mistake("noise") : { status: "neutral" };
      }
    } else {
      hasDanger = true;
      composition.danger += sumCost(chosen);
      if (chosen.length > 0) dangerIncluded = true;
      dangerPicked += chosen.length;
      for (const version of item.versions) {
        options[version.id] = picked.has(version.id)
          ? mistake("danger")
          : { status: "danger-avoided" };
      }
    }
  }

  const isBloated = composition.noise > 0;
  const enoughNeeded = neededIncluded / neededTotal >= MIN_NEEDED_SHARE;
  // Отметка «Верно, что не взяли» должна совпадать с баллом: элемент «ничего опасного
  // не отдали» не засчитан, если взято меньше трёх четвертей нужного или взято хоть одно
  // опасное, — значит, и хвалить не за что
  if (!enoughNeeded || dangerIncluded) {
    for (const [id, review] of Object.entries(options)) {
      if (review.status === "danger-avoided") options[id] = { status: "neutral" };
    }
  }

  const total = neededTotal + (hasDanger ? 1 : 0) + 1;
  const done = Math.max(
    0,
    neededIncluded +
      (enoughNeeded && hasDanger && !dangerIncluded ? 1 : 0) +
      (enoughNeeded && !isBloated ? 1 : 0) -
      dangerPicked,
  );
  const score = done / total;
  const verdict = verdictFromScore(score);

  return {
    score,
    verdict,
    hint: buildHint(verdict, neededIncluded, neededTotal, dangerIncluded, isBloated),
    review: {
      explanation: exercise.explanation,
      details: {
        type: "costed-select",
        options,
        composition,
        needed: { included: neededIncluded, total: neededTotal },
      },
    },
  };
}

// Подсказка называет только счётчик и общие проблемы, но не конкретные варианты
function buildHint(
  verdict: CheckResult["verdict"],
  neededIncluded: number,
  neededTotal: number,
  dangerIncluded: boolean,
  isBloated: boolean,
): string | undefined {
  if (verdict === "correct") return undefined;
  const parts = [`Нужных сведений в промпте: ${neededIncluded} из ${neededTotal}.`];
  if (dangerIncluded) parts.push("В промпт попало то, что нельзя отдавать модели.");
  if (isBloated) parts.push("В промпте есть лишнее.");
  return parts.join(" ");
}

// Все версии всех сведений по id
function optionsById(exercise: CostedSelectExercise): Map<string, CostedOption> {
  return new Map(
    exercise.items.flatMap((item) => item.versions.map((option) => [option.id, option] as const)),
  );
}

function sumCost(versions: CostedOption[]): number {
  return versions.reduce((total, version) => total + version.cost, 0);
}
