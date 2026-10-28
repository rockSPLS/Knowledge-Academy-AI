import type { SavedJourney } from "@/components/journey/saved";
import { journeyResult } from "@/components/journey/results";
import {
  MAX_SUMMARY_EXERCISES,
  MAX_SUMMARY_JOURNEY_CONCEPTS,
  MAX_SUMMARY_MASTERED_CONCEPTS,
  MAX_SUMMARY_MISTAKES,
  MAX_SUMMARY_TEXT,
  type AnswerRecord,
  type ProgressData,
  type ProgressSummary,
  type SummaryAnswer,
} from "@/lib/progress/types";

// Короткая сводка прогресса, которая уходит на сервер вместе с вопросом поиска.
// По каждому упражнению — только последний ответ, плюс несколько последних ошибок
// и понятия путешествий — которые стоит повторить и которые усвоены. Времени и дат в ней нет,
// и она не растёт вместе с историей: пределы — в lib/progress/types.ts.

// Последний ответ на каждое упражнение: exerciseId → запись
export function latestAnswers(answers: AnswerRecord[]): Map<string, AnswerRecord> {
  const latest = new Map<string, AnswerRecord>();
  for (const record of answers) {
    const known = latest.get(record.exerciseId);
    if (!known || record.at >= known.at) latest.set(record.exerciseId, record);
  }
  return latest;
}

const toSummaryAnswer = (record: AnswerRecord): SummaryAnswer => ({
  id: record.exerciseId,
  verdict: record.verdict,
  ...(record.answer && { answer: record.answer }),
});

export function buildProgressSummary(data: ProgressData, journeys: SavedJourney[]): ProgressSummary {
  const exercises = [...latestAnswers(data.answers).values()]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_SUMMARY_EXERCISES)
    .map((record) => ({ id: record.exerciseId, verdict: record.verdict }));

  // Ошибки — от новых к старым, по одной на упражнение (самая поздняя)
  const mistakes: SummaryAnswer[] = [];
  const seen = new Set<string>();
  for (const record of [...data.answers].sort((a, b) => b.at - a.at)) {
    if (mistakes.length >= MAX_SUMMARY_MISTAKES) break;
    if (record.verdict === "correct" || seen.has(record.exerciseId)) continue;
    seen.add(record.exerciseId);
    mistakes.push(toSummaryAnswer(record));
  }

  const journeyConcepts: ProgressSummary["journeyConcepts"] = [];
  const masteredConcepts: ProgressSummary["masteredConcepts"] = [];
  for (const journey of [...journeys].sort((a, b) => b.createdAt - a.createdAt)) {
    for (const checkpoint of journeyResult(journey.progress).checkpoints) {
      const item = {
        journey: journey.progress.journey.title.slice(0, MAX_SUMMARY_TEXT),
        concept: String(checkpoint.concept ?? "").slice(0, MAX_SUMMARY_TEXT),
      };
      if (checkpoint.status === "review" && journeyConcepts.length < MAX_SUMMARY_JOURNEY_CONCEPTS) {
        journeyConcepts.push(item);
      }
      if (checkpoint.status === "mastered" && masteredConcepts.length < MAX_SUMMARY_MASTERED_CONCEPTS) {
        masteredConcepts.push(item);
      }
    }
  }

  return { exercises, mistakes, journeyConcepts, masteredConcepts };
}

export function isEmptySummary(summary: ProgressSummary): boolean {
  return summary.exercises.length === 0 && summary.journeyConcepts.length === 0 && summary.masteredConcepts.length === 0;
}
