"use client";

import { createContext, useContext, useMemo, useReducer } from "react";
import type { CheckResult } from "@/lib/exercises/types";

// Тестовый режим. TestProvider хранит результаты всех упражнений теста,
// а счёт и прогресс вычисляются из них (а не хранятся отдельно).
// Вне TestProvider контекста нет — так упражнение понимает, что оно в статье.

type TestState = {
  results: Record<string, CheckResult>;
};

type TestAction =
  | { type: "answered"; exerciseId: string; result: CheckResult }
  | { type: "reset" };

function testReducer(state: TestState, action: TestAction): TestState {
  switch (action.type) {
    case "answered":
      return { results: { ...state.results, [action.exerciseId]: action.result } };
    case "reset":
      return { results: {} };
  }
}

type TestContextValue = {
  // Результаты по каждому вопросу — пригодятся для подробной итоговой сводки
  results: Record<string, CheckResult>;
  answeredCount: number;
  total: number;
  score: number;
  isFinished: boolean;
  // Номер прохождения: меняется при «пройти заново», чтобы упражнения сбросились
  attempt: number;
  report: (exerciseId: string, result: CheckResult) => void;
  restart: () => void;
};

const TestContext = createContext<TestContextValue | null>(null);

type TestProviderProps = {
  exerciseIds: string[];
  children: React.ReactNode;
};

export function TestProvider({ exerciseIds, children }: TestProviderProps) {
  const [state, dispatch] = useReducer(testReducer, { results: {} });
  const [attempt, nextAttempt] = useReducer((n: number) => n + 1, 0);

  const value = useMemo<TestContextValue>(() => {
    const answered = exerciseIds.filter((id) => Object.hasOwn(state.results, id));
    const score = answered.reduce((sum, id) => sum + state.results[id].score, 0);
    return {
      results: state.results,
      answeredCount: answered.length,
      total: exerciseIds.length,
      score,
      isFinished: exerciseIds.length > 0 && answered.length === exerciseIds.length,
      attempt,
      report: (exerciseId, result) => dispatch({ type: "answered", exerciseId, result }),
      restart: () => {
        dispatch({ type: "reset" });
        nextAttempt();
      },
    };
  }, [exerciseIds, state.results, attempt]);

  return <TestContext.Provider value={value}>{children}</TestContext.Provider>;
}

// Возвращает null, если компонент находится не внутри теста
export function useTestContext(): TestContextValue | null {
  return useContext(TestContext);
}
