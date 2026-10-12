"use client";

import { Moon, Sun } from "lucide-react";
import { useLayoutEffect, useSyncExternalStore } from "react";

// Переключатель светлой и тёмной темы. Тема хранится в атрибуте data-theme
// на <html> (его до первой отрисовки выставляет скрипт в app/layout.tsx)
// и запоминается в localStorage.

type Theme = "light" | "dark";

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

// Подписка на изменения атрибута, чтобы кнопка всегда показывала актуальную тему
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export function ThemeToggle() {
  // На сервере темы пользователя не знаем — считаем светлой (как в разметке по умолчанию)
  const theme = useSyncExternalStore(subscribe, readTheme, (): Theme => "light");
  const isDark = theme === "dark";

  // В режиме разработки React (Strict Mode) при повторном монтировании сбрасывает
  // атрибуты <html> к значениям из JSX и стирает тему, выставленную скриптом.
  // Применяем сохранённую тему ещё раз до отрисовки; в production это ничего не меняет.
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
    } catch {
      // localStorage недоступен — остаётся тема по умолчанию
    }
  }, []);

  function toggle() {
    const next: Theme = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage может быть недоступен (приватный режим) — тема просто не запомнится
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Тёмная тема"
      aria-pressed={isDark}
      title="Тёмная тема"
      className="rounded-md p-2 text-muted transition-colors hover:bg-surface hover:text-foreground"
    >
      {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
