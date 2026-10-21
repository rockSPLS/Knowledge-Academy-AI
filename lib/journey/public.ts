import "server-only";
import { toPublicExercise } from "@/lib/exercises/server";
import type { Journey, PublicJourney } from "./types";

// Публичная часть путешествия — то, что уходит в браузер: упражнения без
// правильных ответов (та же toPublicExercise, что и у банка) и без подсказок
export function toPublicJourney(journey: Journey): PublicJourney {
  return {
    title: journey.title,
    doubts: journey.doubts,
    checkpoints: journey.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      title: checkpoint.title,
      concept: checkpoint.concept,
      summary: checkpoint.summary,
      dependsOn: checkpoint.dependsOn,
      exercises: checkpoint.exercises.map(({ exercise, difficulty }) => ({
        exercise: toPublicExercise(exercise),
        difficulty,
      })),
    })),
  };
}
