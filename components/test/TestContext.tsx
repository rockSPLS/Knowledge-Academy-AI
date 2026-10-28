"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { recordTestAttempt } from "@/components/progress/store";
import { useActiveTime } from "@/components/progress/useActiveTime";
import type { CheckResult } from "@/lib/exercises/types";

// Тестовый режим. TestProvider хранит результаты всех упражнений теста,
// а счёт и прогресс вычисляются из них (а не хранятся отдельно).
// Вне TestProvider контекста нет — так упражнение понимает, что оно в статье.
//
// Ответы отправляются одной кнопкой «Завершить тест»: до этого каждое упражнение
// сообщает тесту черновик — заполнен ли ответ и начат ли он. Из черновиков считаются
// счётчик «Готово N из M», пропущенные вопросы и незаполненные при попытке завершить.
//
// Завершённая попытка записывается в прогресс: дата, счёт и время прохождения — от первого
// ответа, который начали заполнять, до завершения, с паузой после 2 минут без действий,
// как время на статьях (components/progress/useActiveTime.ts).

// Черновик ответа: ready — ответ заполнен и его можно отправить;
// touched — пользователь уже начал отвечать (что-то выбрал, ввёл, переставил)
export type TestDraft = { ready: boolean; touched: boolean };

type TestState = {
  results: Record<string, CheckResult>;
  drafts: Record<string, TestDraft>;
  // Пользователь нажал «Завершить тест», когда не все вопросы были заполнены
  finishAttempted: boolean;
};

type TestAction =
  | { type: "answered"; exerciseId: string; result: CheckResult }
  | { type: "draft"; exerciseId: string; draft: TestDraft }
  | { type: "finishAttempted" }
  | { type: "reset" };

const INITIAL_STATE: TestState = { results: {}, drafts: {}, finishAttempted: false };

function testReducer(state: TestState, action: TestAction): TestState {
  switch (action.type) {
    case "answered":
      return { ...state, results: { ...state.results, [action.exerciseId]: action.result } };
    case "draft": {
      const prev = state.drafts[action.exerciseId];
      // Черновик не изменился — состояние то же, лишней перерисовки нет
      if (prev?.ready === action.draft.ready && prev?.touched === action.draft.touched) {
        return state;
      }
      return { ...state, drafts: { ...state.drafts, [action.exerciseId]: action.draft } };
    }
    case "finishAttempted":
      return state.finishAttempted ? state : { ...state, finishAttempted: true };
    case "reset":
      return INITIAL_STATE;
  }
}

// Что показать на карточке вопроса: не заполнен при попытке завершить (missing),
// пропущен — не начат, а на один из следующих уже начали отвечать (skipped),
// начат, но не закончен — при попытке завершить или если отвечают дальше (incomplete)
export type TestNotice = "missing" | "skipped" | "incomplete" | null;

type TestContextValue = {
  // Результаты по каждому вопросу — пригодятся для подробной итоговой сводки
  results: Record<string, CheckResult>;
  // Сколько вопросов заполнено (до завершения) и сколько всего
  readyCount: number;
  total: number;
  score: number;
  isFinished: boolean;
  // Номер прохождения: меняется при «пройти заново», чтобы упражнения сбросились
  attempt: number;
  report: (exerciseId: string, result: CheckResult) => void;
  setDraft: (exerciseId: string, draft: TestDraft) => void;
  // Упражнение регистрирует функцию отправки своего ответа; возвращает отмену регистрации
  registerSubmitter: (exerciseId: string, submit: () => Promise<void>) => () => void;
  noticeFor: (exerciseId: string) => TestNotice;
  // Завершить тест: если всё заполнено — отправить все ответы и вернуть [],
  // иначе вернуть id незаполненных вопросов (по порядку теста)
  finish: () => Promise<string[]>;
  restart: () => void;
};

const TestContext = createContext<TestContextValue | null>(null);

type TestProviderProps = {
  exerciseIds: string[];
  children: React.ReactNode;
};

export function TestProvider({ exerciseIds, children }: TestProviderProps) {
  const [state, dispatch] = useReducer(testReducer, INITIAL_STATE);
  const [attempt, nextAttempt] = useReducer((n: number) => n + 1, 0);
  // Функции отправки — не состояние: от них ничего не рисуется
  const submitters = useRef(new Map<string, () => Promise<void>>());

  // Стабильные функции: упражнения вызывают их в эффектах, и новая функция на каждую
  // перерисовку теста заставляла бы их заново регистрироваться
  const setDraft = useCallback(
    (exerciseId: string, draft: TestDraft) => dispatch({ type: "draft", exerciseId, draft }),
    [],
  );
  const registerSubmitter = useCallback((exerciseId: string, submit: () => Promise<void>) => {
    submitters.current.set(exerciseId, submit);
    return () => {
      if (submitters.current.get(exerciseId) === submit) submitters.current.delete(exerciseId);
    };
  }, []);

  // Время попытки: идёт с первого начатого ответа до завершения теста
  const isStarted = Object.values(state.drafts).some((draft) => draft.touched);
  const isFinished = exerciseIds.length > 0 && exerciseIds.every((id) => Object.hasOwn(state.results, id));
  const seconds = useRef(0);
  useActiveTime(isStarted && !isFinished, (active) => {
    seconds.current += active;
  });
  // Попытка записывается один раз — когда тест завершён. Время к этому моменту уже
  // досчитано: счёт выключился в том же обновлении, а его уборка идёт раньше этого эффекта
  const recordedAttempt = useRef<number | null>(null);
  useEffect(() => {
    if (!isFinished || recordedAttempt.current === attempt) return;
    recordedAttempt.current = attempt;
    const score = exerciseIds.reduce((sum, id) => sum + (state.results[id]?.score ?? 0), 0);
    recordTestAttempt({ at: Date.now(), score, total: exerciseIds.length, seconds: Math.round(seconds.current) });
  }, [isFinished, attempt, exerciseIds, state.results]);

  const value = useMemo<TestContextValue>(() => {
    const answered = exerciseIds.filter((id) => Object.hasOwn(state.results, id));
    const score = answered.reduce((sum, id) => sum + state.results[id].score, 0);
    const isReady = (id: string) => state.drafts[id]?.ready === true;
    const missing = exerciseIds.filter((id) => !isReady(id));
    // Номер последнего вопроса, на который начали отвечать: всё незаполненное выше — пропущено
    const lastTouched = exerciseIds.findLastIndex((id) => state.drafts[id]?.touched);

    return {
      results: state.results,
      readyCount: exerciseIds.length - missing.length,
      total: exerciseIds.length,
      score,
      isFinished: exerciseIds.length > 0 && answered.length === exerciseIds.length,
      attempt,
      report: (exerciseId, result) => dispatch({ type: "answered", exerciseId, result }),
      setDraft,
      registerSubmitter,
      noticeFor: (exerciseId) => {
        if (isReady(exerciseId)) return null;
        const isStarted = state.drafts[exerciseId]?.touched === true;
        const isBehind = exerciseIds.indexOf(exerciseId) < lastTouched;
        if (!state.finishAttempted && !isBehind) return null;
        if (isStarted) return "incomplete";
        return state.finishAttempted ? "missing" : "skipped";
      },
      finish: async () => {
        if (missing.length > 0) {
          dispatch({ type: "finishAttempted" });
          return missing;
        }
        // Уже отправленные ответы упражнения пропускают сами
        await Promise.allSettled([...submitters.current.values()].map((submit) => submit()));
        return [];
      },
      restart: () => {
        dispatch({ type: "reset" });
        seconds.current = 0;
        nextAttempt();
      },
    };
  }, [exerciseIds, state, attempt, setDraft, registerSubmitter]);

  return <TestContext.Provider value={value}>{children}</TestContext.Provider>;
}

// Возвращает null, если компонент находится не внутри теста
export function useTestContext(): TestContextValue | null {
  return useContext(TestContext);
}
