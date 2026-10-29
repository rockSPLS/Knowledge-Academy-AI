import type { Metadata } from "next";
import { ProgressApp } from "@/components/progress/ProgressApp";
import { getAllExerciseIds, getExercise } from "@/lib/exercises/bank";
import { toPublicExercise } from "@/lib/exercises/server";
import type { PublicExercise } from "@/lib/exercises/types";
import { getArticleTopics } from "@/lib/progress/topics";

export const metadata: Metadata = {
  title: "Мой прогресс",
  description: "Какие темы усвоены и какие стоит повторить, время на статьях, тест и путешествия.",
};

// Страница прогресса. Прогресс хранится в браузере, поэтому страница — оболочка
// для клиентского компонента. Темы статей (какой раздел проверяет каждое упражнение)
// знает индекс поиска на сервере — в браузер уходят только названия, якоря и id упражнений.
// Ещё — упражнения банка без ответов, как в статьях: в файле «Скачать прогресс» ответ с выбором
// записан словами вариантов
export default function ProgressPage() {
  const exercises: Record<string, PublicExercise> = {};
  for (const id of getAllExerciseIds()) {
    const exercise = getExercise(id);
    if (exercise) exercises[id] = toPublicExercise(exercise);
  }
  return <ProgressApp articles={getArticleTopics()} exercises={exercises} />;
}
