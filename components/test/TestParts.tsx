"use client";

import { useEffect, useRef } from "react";
import { useTestContext } from "./TestContext";

// Части страницы теста, которые читают общий тестовый контекст.

const TEST_START_ID = "test-start";

function useRequiredTest() {
  const test = useTestContext();
  if (!test) throw new Error("Компонент теста используется вне TestProvider");
  return test;
}

export function TestProgress() {
  const { answeredCount, total } = useRequiredTest();
  const percent = total === 0 ? 0 : Math.round((answeredCount / total) * 100);

  return (
    // tabIndex={-1} — сюда переводится фокус при «Пройти заново»
    <div
      id={TEST_START_ID}
      tabIndex={-1}
      className="sticky top-0 z-10 space-y-2 bg-background py-3 outline-none"
    >
      <div className="flex justify-between text-sm text-muted">
        <span>
          Отвечено {answeredCount} из {total}
        </span>
        <span>{percent}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Прогресс теста"
        aria-valuetext={`Отвечено ${answeredCount} из ${total}`}
        aria-valuenow={answeredCount}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        <div className="h-full bg-accent-fill transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

// Обёртка для вопросов: при «пройти заново» меняется key, и все упражнения
// сбрасываются в начальное состояние.
export function TestQuestions({ children }: { children: React.ReactNode }) {
  const { attempt } = useRequiredTest();
  return <div key={attempt}>{children}</div>;
}

export function TestSummary() {
  const { isFinished, score, total, restart } = useRequiredTest();
  const summaryRef = useRef<HTMLElement>(null);

  // Тест завершён — переводим фокус к сводке: итог и разбор при этом появляются
  // во всех карточках сразу, и без этого клавиатура и диктор остались бы у последнего вопроса
  useEffect(() => {
    if (isFinished) summaryRef.current?.focus();
  }, [isFinished]);

  if (!isFinished) return null;

  // Баллы бывают дробными (частично верные ответы) — показываем с запятой: «2,6».
  // Округляем вниз, чтобы неидеальный результат никогда не выглядел как максимальный.
  const formattedScore = (Math.floor(score * 10) / 10).toLocaleString("ru-RU", {
    maximumFractionDigits: 1,
  });

  return (
    <section
      ref={summaryRef}
      tabIndex={-1}
      // Имя области — заголовок: при фокусе диктор объявит «Тест завершён»
      aria-labelledby="test-summary-title"
      className="space-y-3 rounded-xl border border-border bg-surface p-5 outline-none"
    >
      <h2 id="test-summary-title" className="text-xl font-semibold">
        Тест завершён
      </h2>
      <p>
        Ваш результат: {formattedScore} из {total}
      </p>
      <p className="text-sm text-muted">Итог и разбор каждого вопроса — в карточках выше.</p>
      <button
        type="button"
        onClick={() => {
          restart();
          // Сводка исчезает вместе с кнопкой — переводим фокус и прокрутку к началу теста
          window.scrollTo({ top: 0 });
          document.getElementById(TEST_START_ID)?.focus({ preventScroll: true });
        }}
        className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
      >
        Пройти заново
      </button>
    </section>
  );
}
