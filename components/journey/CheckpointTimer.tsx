"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Clock, Pause } from "lucide-react";
import { formatTime } from "@/lib/journey/timing";

// Полоса времени чекпоинта — липкая, видна при прокрутке. Цвет: больше половины
// времени — индиго, меньше половины — янтарный, последние 10 секунд — красный
// и пульсирует (если человек не просил уменьшить движение). Звука нет.
// Зелёный не используется: он закреплён за итогом «Верно».
// Пока ИИ оценивает ответ, время стоит: вместо часов — значок паузы, полоса серая.
// Экранному диктору время объявляется не каждую секунду, а на порогах.
// На узком экране слева — маленькая сакура, под временем — очки и серия
// (на широком они в колонке справа).

const LAST_SECONDS = 10;
// Как часто обновлять время на экране, мс
const TICK_MS = 250;

type CheckpointTimerProps = {
  label: string;
  // Момент окончания времени (мс с 1970 г.) и сколько секунд было всего
  deadline: number;
  totalSec: number;
  // Чекпоинт закончен: сколько секунд оставалось; null — время идёт
  stoppedAtSec: number | null;
  // Момент начала паузы (ИИ оценивает ответ); null — паузы нет
  pausedAt: number | null;
  // Только на узком экране: сакура слева и строка очков под временем
  companion?: ReactNode;
  score?: ReactNode;
};

export function CheckpointTimer({
  label,
  deadline,
  totalSec,
  stoppedAtSec,
  pausedAt,
  companion,
  score,
}: CheckpointTimerProps) {
  const stopped = stoppedAtSec !== null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (stopped) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      // Время вышло — дальше обновлять нечего (на паузе момент окончания ещё сдвинется)
      if (current >= deadline && pausedAt === null) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [stopped, deadline, pausedAt]);

  const paused = pausedAt !== null && !stopped;
  // На паузе остаток замирает на моменте её начала
  const remaining = Math.max(0, stopped ? stoppedAtSec : (deadline - (paused ? pausedAt : now)) / 1000);
  const share = totalSec > 0 ? Math.min(1, remaining / totalSec) : 0;
  const isLast = remaining <= LAST_SECONDS;
  const color = paused ? "bg-subtle" : isLast ? "bg-danger" : share <= 0.5 ? "bg-warning" : "bg-accent-fill";
  const pulse = isLast && !stopped && !paused && remaining > 0 ? "motion-safe:animate-pulse" : "";

  // Текст меняется только на порогах — тогда диктор его и озвучит
  let announcement = "";
  if (paused) announcement = "ИИ оценивает ответ — время на паузе";
  else if (!stopped) {
    if (remaining <= 0) announcement = "Время вышло";
    else if (isLast) announcement = `Осталось ${LAST_SECONDS} секунд`;
    else if (share <= 0.5) announcement = "Осталось меньше половины времени";
  }

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 bg-background py-3">
      {companion && <div className="w-11 shrink-0 xl:hidden xl:search-open:block">{companion}</div>}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-4 text-sm text-muted">
          <span>{label}</span>
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground tabular-nums">
            {paused ? <Pause size={16} aria-hidden="true" /> : <Clock size={16} aria-hidden="true" />}
            <span className="sr-only">Осталось времени: </span>
            {formatTime(remaining)}
          </span>
        </div>
        {score && <div className="text-sm text-muted tabular-nums xl:hidden xl:search-open:block">{score}</div>}
        <div className="h-2 overflow-hidden rounded-full bg-border" aria-hidden="true">
          <div
            className={`h-full transition-[width] duration-300 ${color} ${pulse}`}
            style={{ width: `${Math.round(share * 1000) / 10}%` }}
          />
        </div>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </div>
  );
}
