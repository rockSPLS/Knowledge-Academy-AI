"use client";

import { createContext, useContext } from "react";

// Сведения об упражнении банка для прогресса: тема (раздел статьи) и тип упражнения.
// Их передаёт серверный компонент Exercise.tsx — связь «упражнение → раздел» знает
// только индекс поиска на сервере. useExercise по ним записывает проверенный ответ.
// Вне провайдера (упражнения путешествий) ответ в прогресс статей и теста не пишется.

export type ExerciseInfo = { topic: string; type: string };

const ExerciseInfoContext = createContext<ExerciseInfo | null>(null);

export function ExerciseInfoProvider({ topic, type, children }: ExerciseInfo & { children: React.ReactNode }) {
  return <ExerciseInfoContext.Provider value={{ topic, type }}>{children}</ExerciseInfoContext.Provider>;
}

export function useExerciseInfo(): ExerciseInfo | null {
  return useContext(ExerciseInfoContext);
}
