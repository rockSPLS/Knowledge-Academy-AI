"use client";

import { useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { plural } from "@/lib/plural";
import { useTestContext } from "./TestContext";

// Части страницы теста, которые читают общий тестовый контекст.

const TEST_START_ID = "test-start";

function useRequiredTest() {
  const test = useTestContext();
  if (!test) throw new Error("Компонент теста используется вне TestProvider");
  return test;
}

export function TestProgress() {
  // До завершения прогресс — сколько вопросов заполнено (ответы ещё не отправлены)
  const { readyCount, total } = useRequiredTest();
  const percent = total === 0 ? 0 : Math.round((readyCount / total) * 100);

  return (
    // tabIndex={-1} — сюда переводится фокус при «Пройти заново»
    <div
      id={TEST_START_ID}
      tabIndex={-1}
      className="sticky top-0 z-10 space-y-2 bg-background py-3 outline-none"
    >
      <div className="flex justify-between text-sm text-muted">
        <span>
          Готово {readyCount} из {total}
        </span>
        <span>{percent}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Прогресс теста"
        aria-valuetext={`Готово ${readyCount} из ${total}`}
        aria-valuenow={readyCount}
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

// Панель «Завершить тест»: счётчик и одна кнопка для всех ответов. Кнопка не блокируется:
// если что-то не заполнено, по нажатию видно, сколько осталось, незаполненные вопросы
// подсвечены, а страница прокручивается к первому из них
export function TestFinish() {
  const { isFinished, readyCount, total, finish } = useRequiredTest();
  // sending — ответы отправляются; missing — нажали, но заполнено не всё;
  // sent — отправка закончилась, но тест не завершён (часть ответов не дошла — сеть)
  const [state, setState] = useState<"idle" | "sending" | "missing" | "sent">("idle");
  // Номер нажатия: сообщение пересоздаётся, чтобы диктор озвучивал его снова
  const [clickCount, setClickCount] = useState(0);
  // Сколько вопросов не заполнено на момент нажатия. Число в сообщении не меняется,
  // пока его читают: иначе диктор перебивал бы пользователя при каждом заполненном вопросе
  const [missingAtClick, setMissingAtClick] = useState(0);

  if (isFinished) return null;

  async function handleClick() {
    if (state === "sending") return;
    setClickCount((n) => n + 1);
    // Не всё заполнено — без «Отправляю…»: отправлять ещё нечего
    if (readyCount < total) {
      const missing = await finish();
      setMissingAtClick(missing.length);
      setState("missing");
      const first = document.querySelector<HTMLElement>(`[data-exercise-id="${missing[0]}"]`);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      first?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      first?.focus({ preventScroll: true });
      return;
    }
    setState("sending");
    await finish();
    setState("sent");
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <p className="text-sm text-muted">
        Готово {readyCount} из {total}.
        {state === "sent" ? "" : " Пока тест не завершён, ответы можно менять."}
      </p>
      <button
        type="button"
        onClick={handleClick}
        aria-disabled={state === "sending"}
        className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover aria-disabled:opacity-60"
      >
        {state === "sending" ? "Отправляю…" : "Завершить тест"}
      </button>
      {/* Нейтральное оформление: красный и янтарный закреплены за итогами */}
      {state === "missing" && readyCount < total && (
        <p key={clickCount} role="alert" className="flex items-center gap-1.5 text-sm">
          <TriangleAlert size={16} aria-hidden="true" className="shrink-0 text-accent" />
          Ответьте на все вопросы: {plural(missingAtClick, ["остался", "осталось", "осталось"])}{" "}
          {missingAtClick} {plural(missingAtClick, ["вопрос", "вопроса", "вопросов"])}.
        </p>
      )}
      {state === "sent" && (
        <p key={clickCount} role="alert" className="flex items-center gap-1.5 text-sm">
          <TriangleAlert size={16} aria-hidden="true" className="shrink-0 text-muted" />
          Не все ответы удалось отправить. Нажмите «Завершить тест» ещё раз — отправятся
          только они, остальные ответы уже приняты.
        </p>
      )}
    </section>
  );
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
