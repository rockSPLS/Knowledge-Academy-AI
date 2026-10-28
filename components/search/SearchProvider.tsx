"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SearchResponse } from "@/lib/search/types";
import { loadFixtureSearch, SearchApiError, searchMaterials } from "./api";
import { SearchPanel } from "./SearchPanel";

// Состояние панели поиска для всего сайта. Провайдер стоит в общем макете
// (app/layout.tsx), поэтому панель и ответ переживают переход между страницами:
// клик по источнику открывает раздел статьи, а ответ остаётся на месте.
// Последний вопрос и ответ хранятся в sessionStorage на время вкладки: перезагрузка
// страницы не тратит повторный запрос к модели.
//
// Широкий экран (от 1024 px): панель справа, не модальная — страница рядом видна
// и кликается, а содержимое страницы сдвигается влево на ширину панели.
// Узкий экран: панель на весь экран поверх страницы, страница под ней не прокручивается
// и недоступна клавиатуре и экранному диктору (inert).
//
// Пока панель открыта, у обёртки страницы стоит data-search-open: вариант Tailwind
// search-open (globals.css) убирает из-под панели то, что закреплено у правого края окна.

const STORAGE_KEY = "search-panel";
// Ширина, с которой панель стоит сбоку (брейкпоинт lg)
export const WIDE_QUERY = "(min-width: 1024px)";

export type SearchStatus =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "done"; result: SearchResponse };

type SearchContextValue = {
  isOpen: boolean;
  toggle: () => void;
  // returnFocus = false — панель закрылась переходом к источнику: фокус уходит на страницу
  close: (returnFocus?: boolean) => void;
  toggleRef: React.RefObject<HTMLButtonElement | null>;
  question: string;
  setQuestion: (value: string) => void;
  status: SearchStatus;
  submit: () => void;
  loadFixture: (fixture: string) => void;
};

const SearchContext = createContext<SearchContextValue | null>(null);

export function useSearch(): SearchContextValue {
  const value = useContext(SearchContext);
  if (!value) throw new Error("useSearch — только внутри SearchProvider");
  return value;
}

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<SearchStatus>({ state: "idle" });
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  // Номер последнего запроса: ответ на устаревший запрос не перезаписывает новый
  const requestId = useRef(0);
  // Текущий текст поля — чтобы пришедший ответ не затёр новый вопрос, который уже начали печатать
  const questionRef = useRef(question);
  useEffect(() => {
    questionRef.current = question;
  }, [question]);

  // Прошлый вопрос и ответ из sessionStorage — при первом открытии панели
  // (а не при загрузке страницы: так разметка сервера и браузера совпадает)
  const restore = useCallback(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as unknown;
      if (isSavedSearch(saved)) {
        setQuestion(saved.question);
        setStatus({ state: "done", result: saved.result });
      } else if (saved !== null) {
        // Запись повреждена или старого формата — панель открывается пустой
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Хранилище недоступно или запись не JSON — панель просто открывается пустой
    }
  }, []);

  const toggle = useCallback(() => {
    restore();
    setOpen((open) => !open);
  }, [restore]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    // Страница могла быть inert (узкий экран) — снимаем сразу, иначе фокус на кнопку не встанет
    if (pageRef.current) pageRef.current.inert = false;
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  const run = useCallback((asked: string, load: () => Promise<SearchResponse>) => {
    const id = ++requestId.current;
    setStatus({ state: "loading" });
    load().then(
      (result) => {
        if (id !== requestId.current) return;
        setStatus({ state: "done", result });
        // Вопрос из ответа (у сохранённого ответа он свой) — только если поле не меняли
        if (questionRef.current.trim() === asked.trim()) setQuestion(result.question);
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ question: result.question, result }));
        } catch {
          // Не сохранилось — после перезагрузки ответа просто не будет
        }
      },
      (error: unknown) => {
        if (id !== requestId.current) return;
        const message =
          error instanceof SearchApiError ? error.message : "Что-то пошло не так. Попробуйте ещё раз.";
        setStatus({ state: "error", message });
      },
    );
  }, []);

  const submit = useCallback(() => {
    const asked = question.trim();
    if (!asked) return;
    run(asked, () => searchMaterials(asked));
  }, [question, run]);

  const loadFixture = useCallback((fixture: string) => run(question, () => loadFixtureSearch(fixture)), [question, run]);

  // Узкий экран: пока панель открыта, страница под ней не прокручивается и недоступна
  // с клавиатуры. На широком экране панель не модальная — страница рядом работает
  useEffect(() => {
    if (!isOpen) return;
    const wide = window.matchMedia(WIDE_QUERY);
    const root = document.documentElement;
    const page = pageRef.current;
    const apply = () => {
      root.style.overflow = wide.matches ? "" : "hidden";
      if (page) page.inert = !wide.matches;
    };
    apply();
    wide.addEventListener("change", apply);
    return () => {
      wide.removeEventListener("change", apply);
      root.style.overflow = "";
      if (page) page.inert = false;
    };
  }, [isOpen]);

  const value = useMemo(
    () => ({ isOpen, toggle, close, toggleRef, question, setQuestion, status, submit, loadFixture }),
    [isOpen, toggle, close, question, status, submit, loadFixture],
  );

  return (
    <SearchContext.Provider value={value}>
      {/* Пока панель открыта на широком экране, страница сужается на её ширину
          и не уходит под панель. При печати панели нет — и отступа тоже */}
      <div
        ref={pageRef}
        data-search-open={isOpen ? "" : undefined}
        className={`flex flex-1 flex-col ${isOpen ? "lg:pr-[22rem] xl:pr-[26rem] print:pr-0" : ""}`}
      >
        {children}
      </div>
      <SearchPanel />
    </SearchContext.Provider>
  );
}

// Запись sessionStorage — от этой версии панели (вопрос и ответ с источниками)
function isSavedSearch(value: unknown): value is { question: string; result: SearchResponse } {
  if (typeof value !== "object" || value === null) return false;
  const { question, result } = value as { question?: unknown; result?: Partial<SearchResponse> | null };
  return (
    typeof question === "string" &&
    typeof result === "object" &&
    result !== null &&
    typeof result.question === "string" &&
    Array.isArray(result.sources) &&
    (result.answer === null || typeof result.answer?.text === "string")
  );
}
