import { loadSavedJourneys, type SavedJourney } from "@/components/journey/saved";
import { loadProgressData } from "@/components/progress/store";
import { buildProgressSummary, isEmptySummary } from "@/components/progress/summary";
import { MAX_SEARCH_REQUEST_BYTES } from "@/lib/llm/limits";
import { MAX_JOURNEY_TEXT, MAX_SAVED_JOURNEYS, type ProgressSummary } from "@/lib/progress/types";
import type { JourneySearchInput } from "@/lib/search/types";

// Что браузер отправляет вместе с вопросом поиска: короткую сводку прогресса
// (components/progress/summary.ts) и сохранённые путешествия — только названия, понятия,
// конспекты и векторы чекпоинтов, без упражнений и ответов. Пределы — те же, что проверяет
// сервер (lib/search/request.ts): не больше MAX_SAVED_JOURNEYS путешествий, строки не длиннее
// MAX_JOURNEY_TEXT. Если запрос всё равно не помещается в предел сервера (очень длинные
// конспекты), самые старые путешествия не отправляются.

export type SearchContext = { progress?: ProgressSummary; journeys?: JourneySearchInput[] };

// Сохранённое путешествие проверено мягче, чем запрос: строка может быть длиннее или пропасть
const clip = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_JOURNEY_TEXT) : "");

// Путешествие для запроса. Разбору ошибок (components/review/api.ts) векторы не нужны
export function toSearchInput(saved: SavedJourney, withVectors = true): JourneySearchInput {
  const { journey } = saved.progress;
  return {
    id: saved.id,
    title: clip(journey.title),
    checkpoints: journey.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      title: clip(checkpoint.title),
      concept: clip(checkpoint.concept),
      summary: clip(checkpoint.summary),
    })),
    ...(withVectors && saved.vectors && { vectors: saved.vectors }),
  };
}

export function searchContext(question: string): SearchContext {
  const journeys = loadSavedJourneys();
  const summary = buildProgressSummary(loadProgressData(), journeys);
  const context: SearchContext = {
    ...(!isEmptySummary(summary) && { progress: summary }),
    // От новых к старым: если места не хватит, отбрасываются старые
    journeys: [...journeys]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_SAVED_JOURNEYS)
      .map((journey) => toSearchInput(journey)),
  };
  // Запас на служебные поля и экранирование
  const limit = MAX_SEARCH_REQUEST_BYTES - 2048;
  while (context.journeys!.length > 0 && byteLength({ question, ...context }) > limit) context.journeys!.pop();
  if (context.journeys!.length === 0) delete context.journeys;
  return context;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
