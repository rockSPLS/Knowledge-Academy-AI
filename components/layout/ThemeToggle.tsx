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

// Меняет тему одновременно для всех элементов: на время смены отключаются
// собственные плавные переходы цвета у карточек и кнопок, иначе они «догоняют» фон
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.themeSwitching = "";
  root.dataset.theme = theme;
  // Принудительный пересчёт стилей, чтобы новые цвета применились без переходов
  void root.offsetHeight;
  delete root.dataset.themeSwitching;
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // localStorage может быть недоступен (приватный режим) — тема просто не запомнится
  }
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
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Плавное затемнение/осветление всей страницы целиком (View Transitions API):
    // браузер растворяет «снимок» старой темы в новую. Если браузер этого не умеет
    // или пользователь просил уменьшить движение — тема меняется мгновенно, но тоже целиком.
    if ("startViewTransition" in document && !prefersReducedMotion) {
      document.startViewTransition(() => applyTheme(next));
    } else {
      applyTheme(next);
    }
  }

  // Подпись говорит, что сделает нажатие: при тёмной теме на кнопке солнце и
  // «Включить светлую тему». Постоянная подпись «Тёмная тема» при уже включённой
  // тёмной теме читалась как противоречие
  const label = isDark ? "Включить светлую тему" : "Включить тёмную тему";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 sm:p-2 text-muted transition-colors hover:bg-surface hover:text-foreground"
    >
      {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
    </button>
  );
}
