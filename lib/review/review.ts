import "server-only";
import { z } from "zod";
import type { LanguageModelUsage } from "ai";
import { generateStructured, type ModelResult } from "@/lib/llm/client";
import { hasProgress } from "@/lib/search/progress";
import { fitsScripts, foreignScripts } from "@/lib/search/scripts";
import type { ReviewContextInput } from "./request";
import { collectMaterial, fragmentText, hasMistakes, toReviewSource, type ReviewMaterial } from "./material";
import { REVIEW_SYSTEM, reviewPrompt } from "./prompts";
import { MAX_REVIEW_ITEMS, type Review, type ReviewResponse, type ReviewSource } from "./types";

// Разбор ошибок по сводке прогресса. Нет прогресса или ошибок — модель не вызывается.
// Иначе сервер собирает темы и фрагменты (material.ts), модель пишет разбор по схеме,
// а сервер проверяет номера фрагментов, как в поиске: чужие убираются, ссылки строит код.
// Пункт без годного источника не показывается; не осталось ни одного — разбора нет, как при
// ответе не по схеме (браузер пишет «ИИ ответил с ошибкой» и показывает, что стоит повторить).

// Тайм-аут и потолок длины ответа: до 5 пунктов по 2–4 предложения
const REVIEW_TIMEOUT_MS = 40_000;
const REVIEW_MAX_OUTPUT_TOKENS = 3000;

// Схема ответа модели — только форма, без ограничений длины (как в lib/journey/schemas.ts):
// число пунктов и номера проверяет checkReview
export const reviewSchema = z.object({
  summary: z.string(),
  items: z.array(
    z.object({
      topic: z.string(),
      mistake: z.string(),
      review: z.string(),
      fragments: z.array(z.number()),
    }),
  ),
});

export type ReviewOutput = z.infer<typeof reviewSchema>;

export type AskReview = (request: {
  system: string;
  prompt: string;
  abortSignal?: AbortSignal;
  // Расход токенов — для замеров (app/api/review/dev)
  onUsage?: (usage: LanguageModelUsage) => void;
}) => Promise<ModelResult<ReviewOutput>>;

export const askReview: AskReview = ({ system, prompt, abortSignal, onUsage }) =>
  generateStructured({
    schema: reviewSchema,
    system,
    prompt,
    timeoutMs: REVIEW_TIMEOUT_MS,
    maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
    abortSignal,
    onUsage,
  });

export type ReviewRequest = Omit<ReviewContextInput, "journeyExercises"> & {
  // Упражнения понятий путешествий с ошибкой (lib/review/request.ts); нет — у понятий только конспект
  journeyExercises?: ReviewContextInput["journeyExercises"];
  ask?: AskReview;
  abortSignal?: AbortSignal;
  // Уже собранные темы и фрагменты (сохранённые ответы — fixtures.ts)
  material?: ReviewMaterial;
  // Темы и фрагменты, которые получила модель, — для записи сохранённого ответа
  onMaterial?: (material: ReviewMaterial) => void;
};

export async function reviewProgress({
  journeys,
  progress,
  journeyExercises = [],
  ask = askReview,
  abortSignal,
  material,
  onMaterial,
}: ReviewRequest): Promise<ReviewResponse> {
  if (!progress || !hasProgress(progress)) return { status: "no-progress" };
  if (!hasMistakes(progress)) return { status: "no-mistakes" };

  const collected = material ?? (await collectMaterial(progress, journeys, journeyExercises, abortSignal));
  onMaterial?.(collected);
  const result = await ask({ system: REVIEW_SYSTEM, prompt: reviewPrompt(collected), abortSignal });
  if (!result.ok) return { status: "failed", reason: result.reason };
  const review = checkReview(result.data, collected);
  return review ? { status: "done", review } : { status: "failed", reason: "invalid-output" };
}

// Номера фрагментов в квадратных скобках в тексте пункта — не источники, а мусор:
// ссылки идут отдельным списком
const cleanText = (text: string) =>
  text
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

// Проверка разбора: номера — только из переданных фрагментов, ссылки строит код.
// Одна ссылка дважды (раздел и упражнение к нему ведут в одно место) — показывается один раз.
// Название пункта — название темы от сервера, а не то, что написала модель.
// Пункт без годного источника, без текста или с чужим письмом, которого нет в его фрагментах
// (lib/search/scripts.ts), отбрасывается; общий вывод с письмом, которого нет ни в одном фрагменте, не показывается;
// null — не осталось ни одного пункта
export function checkReview(output: ReviewOutput, material: ReviewMaterial): Review | null {
  const count = material.fragments.length;
  const fragmentScripts = material.fragments.map((fragment) => foreignScripts(fragmentText(fragment)));
  const items = output.items.flatMap((item) => {
    const sources: ReviewSource[] = [];
    const allowed = new Set<string>();
    for (const n of item.fragments) {
      if (!Number.isInteger(n) || n < 1 || n > count) continue;
      fragmentScripts[n - 1].forEach((name) => allowed.add(name));
      const source = toReviewSource(material.fragments[n - 1]);
      if (!sources.some((known) => known.href === source.href)) sources.push(source);
    }
    // Название пункта ставит сервер (name темы): у понятия — его название из сводки, у темы
    // статьи — понятное без статьи (topicTitles.ts). Модель то брала понятие в кавычки, то копировала
    // строку списка, а у разделов с общим названием писала «Почему они возникают». Тема узнаётся
    // по первому фрагменту (чекпоинт у понятия, раздел у темы статьи), понятия — первыми: их разделы
    // могут совпасть с разделом темы статьи. У сохранённых разборов тем нет — как ответила модель,
    // без кавычек по краям
    const owner =
      material.topics.find((known) => known.kind === "journey" && item.fragments.includes(known.fragments[0])) ??
      material.topics.find((known) => known.kind === "article" && item.fragments.includes(known.fragments[0]));
    const topic = owner ? owner.name : cleanText(item.topic).replace(/^["«„“]+|["»“”]+$/g, "");
    const mistake = cleanText(item.mistake);
    const review = cleanText(item.review);
    if (sources.length === 0 || !topic || (!mistake && !review)) return [];
    if (!fitsScripts(topic + mistake + review, allowed)) return [];
    return [{ topic, mistake, review, sources }];
  });
  if (items.length === 0) return null;
  const summary = cleanText(output.summary);
  const allScripts = new Set(fragmentScripts.flatMap((scripts) => [...scripts]));
  return { summary: fitsScripts(summary, allScripts) ? summary : "", items: items.slice(0, MAX_REVIEW_ITEMS) };
}
