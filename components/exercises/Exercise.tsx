import { ExerciseInfoProvider } from "@/components/progress/ExerciseInfo";
import { getExercise } from "@/lib/exercises/bank";
import { toPublicExercise } from "@/lib/exercises/server";
import { getTopicOfExercise } from "@/lib/progress/topics";
import { ExerciseView } from "./ExerciseView";

// Серверный компонент: находит упражнение в банке по id и передаёт в браузер
// только публичную часть. Используется в статьях как <Exercise id="..." />
// и в итоговом тесте. Тема упражнения (раздел статьи) и его тип — для прогресса:
// с ними браузер записывает проверенный ответ (components/progress/ExerciseInfo.tsx).

export function Exercise({ id }: { id: string }) {
  const exercise = getExercise(id);
  if (!exercise) {
    throw new Error(`Упражнение "${id}" не найдено в банке вопросов`);
  }
  return (
    <ExerciseInfoProvider topic={getTopicOfExercise(id)?.key ?? ""} type={exercise.type}>
      <ExerciseView exercise={toPublicExercise(exercise)} />
    </ExerciseInfoProvider>
  );
}
