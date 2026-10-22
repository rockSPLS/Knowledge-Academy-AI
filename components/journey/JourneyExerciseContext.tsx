"use client";

import { createContext, useContext } from "react";
import type { CheckResult } from "@/lib/exercises/types";
import type { ExerciseOutcome } from "./state";

// Упражнение внутри путешествия. Те же компоненты упражнений, что и в статьях,
// через этот контекст узнают, что они в путешествии: ответ проверяется по
// зашифрованному путешествию, попыток не больше двух, есть подсказка и таймер.
// Вне путешествия контекста нет (как и у теста — см. components/test/TestContext.tsx).

export type JourneyExerciseApi = {
  // Сколько попыток даётся: у «верно/неверно» одна — вторая была бы угадыванием
  maxAttempts: (exerciseId: string) => number;
  attemptsUsed: (exerciseId: string) => number;
  check: (exerciseId: string, answer: unknown, reveal: boolean) => Promise<CheckResult>;
  // Запоминает попытку (номер или "same" — раскрытие ответа, не новая попытка);
  // если в результате есть разбор — это итог упражнения
  recordCheck: (exerciseId: string, result: CheckResult, attempt: number | "same") => void;
  // Время вышло, а ответа нет: запрашивает объяснение и записывает итог «не успели».
  // unrated — свободный ответ пропущен без оценки, потому что модель недоступна
  skip: (exerciseId: string, unrated?: boolean) => Promise<void>;
  outcomeFor: (exerciseId: string) => ExerciseOutcome | undefined;
  hintFor: (exerciseId: string) => string | undefined;
  requestHint: (exerciseId: string) => Promise<void>;
  // Время чекпоинта вышло: для отрисовки — isTimeUp, внутри уже идущих запросов — readTimeUp()
  isTimeUp: boolean;
  readTimeUp: () => boolean;
  // Упражнение регистрирует, что сделать, когда время выйдет (отправить ответ как есть;
  // true — всё отправлено); возвращает отмену регистрации
  registerFinalizer: (exerciseId: string, finalize: () => Promise<boolean>) => () => void;
};

export const JourneyExerciseContext = createContext<JourneyExerciseApi | null>(null);

// Возвращает null, если упражнение не в путешествии
export function useJourneyExercise(): JourneyExerciseApi | null {
  return useContext(JourneyExerciseContext);
}
