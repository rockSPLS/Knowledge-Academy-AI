import { z } from "zod";
import { FREE_ANSWER_KINDS } from "@/lib/exercises/types";

// Схемы ответов модели. Описывают только форму ответа: все поля обязательные,
// без словарей и ограничений длины — такие схемы принимают провайдеры
// со строгим режимом структурированного ответа. Содержание (число вариантов,
// длина текстов, уровни сложности) проверяет build.ts — с понятным текстом ошибки,
// который уходит модели при повторе.

// Типы упражнений, которые умеет генерировать путешествие: базовые и свободный ответ
export const GENERATED_TYPES = [
  "multiple-choice",
  "true-false",
  "fill-blank",
  "match-pairs",
  "order-steps",
  "free-answer",
] as const;

export type GeneratedType = (typeof GENERATED_TYPES)[number];

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
      keyFacts: z.array(z.string()),
      misconceptions: z.array(z.string()),
      // Номера более ранних чекпоинтов (с 1)
      dependsOn: z.array(z.number()),
      exerciseTypes: z.array(z.enum(GENERATED_TYPES)),
      // Вид свободного ответа, если free-answer есть среди exerciseTypes, иначе "none".
      // Вид выбирает план: он видит все понятия сразу и может сделать виды разными
      freeAnswerKind: z.enum(["none", ...FREE_ANSWER_KINDS]),
    }),
  ),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanCheckpoint = Plan["checkpoints"][number];

// ---------- Шаг 2: упражнения одного чекпоинта ----------
// Модель пишет только содержание. id, порядок показа и перемешивание задаёт build.ts

// Общие поля всех упражнений
const common = {
  difficulty: z.number(),
  hint: z.string(),
  question: z.string(),
  explanation: z.string(),
};

const generatedExerciseSchema = z.discriminatedUnion("type", [
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
    // Вид задания не пишется здесь — он задан в плане (freeAnswerKind)
    // 2–3 мысли, которые должны быть в ответе
    criteria: z.array(z.string()),
    // Образец ответа — показывается при раскрытии
    sample: z.string(),
  }),
]);

export type GeneratedExercise = z.infer<typeof generatedExerciseSchema>;

export const checkpointExercisesSchema = z.object({
  exercises: z.array(generatedExerciseSchema),
});

export type CheckpointExercises = z.infer<typeof checkpointExercisesSchema>;
