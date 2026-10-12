import { getExercise } from "@/lib/exercises/bank";
import { toPublicExercise } from "@/lib/exercises/server";
import { ExerciseView } from "./ExerciseView";

// Серверный компонент: находит упражнение в банке по id и передаёт в браузер
// только публичную часть. Используется в статьях как <Exercise id="..." />
// и в итоговом тесте.

export function Exercise({ id }: { id: string }) {
  const exercise = getExercise(id);
  if (!exercise) {
    throw new Error(`Упражнение "${id}" не найдено в банке вопросов`);
  }
  return <ExerciseView exercise={toPublicExercise(exercise)} />;
}
