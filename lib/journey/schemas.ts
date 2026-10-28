import { z } from "zod";
import { FREE_ANSWER_KINDS } from "@/lib/exercises/types";

// Схемы ответов модели. Описывают в основном форму ответа: все поля обязательные,
// без словарей и ограничений длины — такие схемы принимают провайдеры
// со строгим режимом структурированного ответа. Исключение — минимум ключевых
// фактов в плане (.min → minItems в JSON Schema; строгий режим OpenAI его
// поддерживает). Содержание (число вариантов, длина текстов, уровни сложности)
// проверяет build.ts — с понятным текстом ошибки, который уходит модели при повторе.

// Типы упражнений, которые умеет генерировать путешествие: базовые, свободный ответ
// и калибровка уверенности
export const GENERATED_TYPES = [
  "multiple-choice",
  "true-false",
  "fill-blank",
  "match-pairs",
  "order-steps",
  "free-answer",
  "calibration",
] as const;

export type GeneratedType = (typeof GENERATED_TYPES)[number];

// Типы, которые план отмечает как подходящие к понятию. Свободный ответ план
// отмечает видами (freeAnswerKinds), калибровку ставит сервер (layout.ts)
export const BASIC_TYPES = [
  "multiple-choice",
  "true-false",
  "fill-blank",
  "match-pairs",
  "order-steps",
] as const;

export type BasicType = (typeof BASIC_TYPES)[number];

// ---------- Шаг 1: план путешествия ----------

export const planSchema = z.object({
  // false — материал не подходит (не учебный, бессмысленный, слишком скудный)
  suitable: z.boolean(),
  // Если не подходит — коротко, что не так (видит пользователь); иначе пустая строка
  problem: z.string(),
  title: z.string(),
  // Утверждения присланного текста, которые расходятся с общепринятыми сведениями
  doubts: z.array(z.object({ claim: z.string(), note: z.string() })),
  checkpoints: z.array(
    z.object({
      title: z.string(),
      concept: z.string(),
      summary: z.string(),
      // Не меньше двух фактов — уже в схеме: модель не может прислать меньше,
      // и план не уходит на повтор из-за этого (сервер проверяет ещё и пустые строки)
      keyFacts: z.array(z.string()).min(2),
      // Без минимума: схема заставила бы выдумывать заблуждение там, где его нет
      misconceptions: z.array(z.string()),
      // Номера более ранних чекпоинтов (с 1)
      dependsOn: z.array(z.number()),
      // Отметки модели: какие типы подходят к содержанию понятия. Это суждение
      // о самом понятии, без правил для всего путешествия: любой ответ допустим.
      // Какие типы попадут в чекпоинт, решает сервер (layout.ts)
      suitableTypes: z.array(z.enum(BASIC_TYPES)),
      // Подходящие виды свободного ответа, от самого подходящего; пустой список —
      // свободный ответ понятию не нужен
      freeAnswerKinds: z.array(z.enum(FREE_ANSWER_KINDS)),
    }),
  ),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanCheckpoint = Plan["checkpoints"][number];

// ---------- Шаг 1 по материалам портала ----------
// Тот же план, но у чекпоинта — номера фрагментов, на которых он построен (их проверяет
// сервер, lib/journey/portal.ts), а сомнительных утверждений нет: материал — статьи портала

export const portalPlanSchema = z.object({
  suitable: planSchema.shape.suitable,
  problem: planSchema.shape.problem,
  title: planSchema.shape.title,
  checkpoints: z.array(planSchema.shape.checkpoints.element.extend({ sources: z.array(z.number()) })),
});

export type PortalPlan = z.infer<typeof portalPlanSchema>;

// ---------- Шаг 2: упражнения одного чекпоинта ----------
// Модель пишет только содержание. id, порядок показа и перемешивание задаёт build.ts.
// В списке — упражнения заданных типов и последним запасное (тип тоже задан);
// какое упражнение основное, а какое запасное, build.ts определяет по типам

// Общие поля всех упражнений. checks — какой факт или заблуждение проверяет упражнение:
// модель пишет его первым, чтобы упражнения чекпоинта не повторяли друг друга.
// В путешествие не попадает (build.ts его не переносит)
const common = {
  checks: z.string(),
  difficulty: z.number(),
  hint: z.string(),
  question: z.string(),
  explanation: z.string(),
};

// Обычное объединение, а не z.discriminatedUnion: тот в JSON Schema даёт oneOf, а строгий
// режим структурированного ответа у части провайдеров принимает только anyOf (HTTP 400).
// Варианты различаются полем type, поэтому подходит всегда ровно один — смысл тот же
const generatedExerciseSchema = z.union([
  z.object({
    type: z.literal("multiple-choice"),
    ...common,
    // feedback — почему вариант неверен (пустая строка, если пояснение не нужно)
    options: z.array(z.object({ text: z.string(), correct: z.boolean(), feedback: z.string() })),
  }),
  z.object({
    type: z.literal("true-false"),
    ...common,
    statements: z.array(
      z.object({ text: z.string(), isTrue: z.boolean(), explanation: z.string() }),
    ),
  }),
  z.object({
    type: z.literal("fill-blank"),
    ...common,
    // Пропуски в тексте — [[1]], [[2]]…; blanks — по порядку номеров
    text: z.string(),
    blanks: z.array(z.object({ accepted: z.array(z.string()) })),
  }),
  z.object({
    type: z.literal("match-pairs"),
    ...common,
    pairs: z.array(z.object({ term: z.string(), definition: z.string() })),
  }),
  z.object({
    type: z.literal("order-steps"),
    ...common,
    // Шаги в верном порядке
    steps: z.array(z.string()),
  }),
  z.object({
    type: z.literal("free-answer"),
    ...common,
    // Вид задания не пишется здесь — его назначает сервер по отметкам плана (layout.ts)
    // 2–3 мысли, которые должны быть в ответе
    criteria: z.array(z.string()),
    // Образец ответа — показывается при раскрытии
    sample: z.string(),
  }),
  z.object({
    type: z.literal("calibration"),
    ...common,
    // Короткие вопросы и правильный ответ на каждый — слово или фраза
    items: z.array(z.object({ question: z.string(), answer: z.string() })),
  }),
]);

export type GeneratedExercise = z.infer<typeof generatedExerciseSchema>;

export const checkpointExercisesSchema = z.object({
  exercises: z.array(generatedExerciseSchema),
});

export type CheckpointExercises = z.infer<typeof checkpointExercisesSchema>;
