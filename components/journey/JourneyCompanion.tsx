import { plural } from "@/lib/plural";
import { factorText, STREAK_FACTOR, STREAK_LENGTH, type Gamification } from "./gamification";
import { Sakura } from "./Sakura";

// Сакура и счёт во время прохождения. На широком экране — колонка справа от чекпоинта
// (липкая, видна при прокрутке), на узком — маленькая сакура и строка очков
// в полосе времени (см. CheckpointTimer).

const STREAK_TEXT = factorText(STREAK_FACTOR);

// Пояснение к сакуре: что её растит и что поправимо
export const GROW_TEXT = "Растите своё дерево знаний: верный ответ — новые листья, а ошибка их желтит (но это поправимо).";

export function pointsText(points: number): string {
  return `${points} ${plural(points, ["очко", "очка", "очков"])}`;
}

// «34 очка · серия 3 · ×1,5»: множитель показан, когда он действует на следующий ответ
export function ScoreLine({ game }: { game: Gamification }) {
  const active = game.streak >= STREAK_LENGTH;
  return (
    <>
      <span className="font-medium text-foreground">{pointsText(game.total)}</span> · серия {game.streak}
      {active && (
        <>
          {" "}
          · <span className="rounded bg-accent-soft px-1.5 text-accent-soft-foreground">{STREAK_TEXT}</span>
        </>
      )}
    </>
  );
}

export function MiniSakura({ game }: { game: Gamification }) {
  return <Sakura leaves={game.leaves} started={game.startedCheckpoints} bloom={false} className="w-full" />;
}

// Колонка справа: только на широком экране — по бокам основной колонки сайта там есть место
export function CompanionAside({ game }: { game: Gamification }) {
  return (
    <aside aria-label="Прогресс" className="absolute inset-y-0 left-full ml-8 hidden w-44 xl:block">
      <div className="sticky top-4 space-y-2 rounded-xl border border-border bg-surface p-3 text-center text-sm text-muted tabular-nums">
        <p className="font-medium text-foreground">Дерево знаний</p>
        <Sakura leaves={game.leaves} started={game.startedCheckpoints} bloom={false} className="w-full" />
        <p>
          <ScoreLine game={game} />
        </p>
        {game.streak >= STREAK_LENGTH && (
          <p className="text-xs">Следующие ответы — {STREAK_TEXT}, пока серия не прервётся</p>
        )}
        <p className="text-xs leading-relaxed">{GROW_TEXT}</p>
      </div>
    </aside>
  );
}
