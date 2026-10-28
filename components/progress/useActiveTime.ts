"use client";

import { useCallback, useEffect, useRef } from "react";

// Активное время на странице: вкладка видна и последнее действие человека (прокрутка,
// мышь, клавиши, касание) было не дольше IDLE_MS назад. Через 2 минуты без действий
// счёт встаёт на паузу — забытая на ночь вкладка не запишет часы чтения — и идёт снова
// с первым действием. Накопленное отдаётся onFlush понемногу: раз в FLUSH_MS, при уходе
// со страницы, скрытии вкладки и по вызову возвращаемой функции — закрытие вкладки
// теряет не больше нескольких секунд.

const IDLE_MS = 2 * 60 * 1000;
const TICK_MS = 1000;
const FLUSH_MS = 15_000;
// Между тиками больше нескольких секунд — компьютер спал или вкладку притормозил браузер:
// это время не считается
const MAX_STEP_MS = 5000;

const ACTIVITY_EVENTS = ["scroll", "wheel", "mousemove", "pointerdown", "keydown", "touchstart"] as const;

export function useActiveTime(enabled: boolean, onFlush: (seconds: number) => void): () => void {
  const onFlushRef = useRef(onFlush);
  useEffect(() => {
    onFlushRef.current = onFlush;
  });
  const pendingMs = useRef(0);

  const flush = useCallback(() => {
    const seconds = pendingMs.current / 1000;
    pendingMs.current = 0;
    if (seconds > 0) onFlushRef.current(seconds);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let lastActivity = Date.now();
    let lastTick = Date.now();
    let sinceFlush = 0;

    const tick = () => {
      const now = Date.now();
      const step = Math.min(now - lastTick, MAX_STEP_MS);
      lastTick = now;
      if (document.visibilityState === "visible" && now - lastActivity < IDLE_MS) pendingMs.current += step;
      sinceFlush += step;
      if (sinceFlush >= FLUSH_MS) {
        sinceFlush = 0;
        flush();
      }
    };
    const onActivity = () => {
      lastActivity = Date.now();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // Вернулись на вкладку — это действие; время, пока она была скрыта, не считается
        lastTick = Date.now();
        lastActivity = lastTick;
      } else {
        tick();
        flush();
      }
    };
    const onPageHide = () => {
      tick();
      flush();
    };

    const timer = window.setInterval(tick, TICK_MS);
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(timer);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      tick();
      flush();
    };
  }, [enabled, flush]);

  return flush;
}
