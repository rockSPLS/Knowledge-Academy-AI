"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { AlarmClockCheck, BookOpen, CircleCheck, Flag, Sparkles, Target, TriangleAlert, Zap } from "lucide-react";
import { plural } from "@/lib/plural";
import { checkpointSeconds, formatTime } from "@/lib/journey/timing";
import type { PublicJourney } from "@/lib/journey/types";
import { computeGamification, isFullyCorrect, type Achievements } from "./gamification";
import { JourneyCheckpoint } from "./JourneyCheckpoint";
import { GROW_TEXT, pointsText } from "./JourneyCompanion";
import { JourneyForm } from "./JourneyForm";
import { Sakura } from "./Sakura";
import {
  journeyReducer,
  loadProgress,
  saveProgress,
  type JourneyAction,
  type JourneyProgress,
} from "./state";

// Страница путешествия целиком: форма → старт (выбор «изучить» или «сразу проверить») →
// конспекты (если выбрали «изучить») → чекпоинты по очереди → конец путешествия.
// Состояние — в useReducer (state.ts) и в localStorage: перезагрузка страницы
// возвращает туда же, где человек остановился.

const PRIMARY_BUTTON =
  "inline-flex items-center gap-2 rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover";
const SECONDARY_BUTTON =
  "inline-flex items-center gap-2 rounded-md border border-transparent bg-accent-soft px-4 py-2 text-sm font-medium text-accent-soft-foreground transition-colors hover:border-accent";

export function JourneyApp() {
  // undefined — localStorage ещё не прочитан: на сервере его нет, поэтому читаем после загрузки
  const [state, dispatch] = useReducer(journeyReducer, undefined);

  useEffect(() => {
    dispatch({ type: "load", progress: loadProgress() });
  }, []);

  useEffect(() => {
    if (state !== undefined) saveProgress(state);
  }, [state]);

  // Новый экран — к началу страницы (кнопка перехода была внизу)
  const stageKey = state ? `${state.stage.kind}-${"index" in state.stage ? state.stage.index : ""}` : String(state);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [stageKey]);

  if (state === undefined) return <div className="min-h-64" aria-busy="true" />;

  if (state === null) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-semibold">Путешествие по знаниям</h1>
        <p className="text-lg text-muted">
          Введите тему или вставьте текст — ИИ составит маршрут из нескольких чекпоинтов. В каждом —
          короткий конспект одного понятия и упражнения на время: от простого к сложному.
        </p>
        <JourneyForm onCreated={(generated) => dispatch({ type: "create", ...generated })} />
      </div>
    );
  }

  const { stage } = state;
  return (
    <div className="space-y-6">
      <JourneyHeader journey={state.journey} finished={stage.kind === "finished"} dispatch={dispatch} />
      {stage.kind === "start" && <JourneyStart progress={state} dispatch={dispatch} />}
      {stage.kind === "study" && <JourneyStudy journey={state.journey} dispatch={dispatch} />}
      {stage.kind === "checkpoint" && (
        <JourneyCheckpoint
          key={state.journey.checkpoints[stage.index]?.id}
          progress={state}
          index={stage.index}
          dispatch={dispatch}
        />
      )}
      {stage.kind === "finished" && <JourneyFinish progress={state} dispatch={dispatch} />}
    </div>
  );
}

// Название путешествия, пометка «составлено ИИ» и «Новое путешествие».
// Пока путешествие не пройдено, «Новое путешествие» спрашивает подтверждение:
// текущее удалится, а заново составить его — снова запросы к модели
function JourneyHeader({
  journey,
  finished,
  dispatch,
}: {
  journey: PublicJourney;
  finished: boolean;
  dispatch: (action: JourneyAction) => void;
}) {
  const [isConfirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isConfirming) confirmRef.current?.focus();
  }, [isConfirming]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-sm text-muted">Путешествие по знаниям</p>
          <h1 className="text-3xl font-semibold">{journey.title}</h1>
        </div>
        {!isConfirming && (
          <button
            type="button"
            onClick={() => (finished ? dispatch({ type: "discard" }) : setConfirming(true))}
            className="mt-1 rounded-md border border-border-strong bg-background px-3 py-1.5 text-sm font-medium hover:bg-border"
          >
            Новое путешествие
          </button>
        )}
      </div>
      {isConfirming && (
        <div role="group" aria-label="Подтверждение" className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <p>Текущее путешествие и его прогресс удалятся. Начать новое?</p>
          <div className="flex flex-wrap gap-2">
            <button
              ref={confirmRef}
              type="button"
              onClick={() => dispatch({ type: "discard" })}
              className="rounded-md border border-border-strong bg-background px-3 py-1.5 font-medium hover:bg-border"
            >
              Да, начать новое
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-transparent bg-accent-soft px-3 py-1.5 font-medium text-accent-soft-foreground hover:border-accent"
            >
              Продолжить это
            </button>
          </div>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-sm text-muted">
        <Sparkles size={16} aria-hidden="true" className="text-accent" />
        Конспекты и вопросы составлены ИИ и могут содержать ошибки.
      </p>
    </div>
  );
}

// Утверждения присланного текста, которые расходятся с общепринятыми сведениями.
// Не «ложь», а «проверьте»: модель тоже может ошибаться
function Doubts({ journey }: { journey: PublicJourney }) {
  if (journey.doubts.length === 0) return null;
  return (
    <section aria-labelledby="doubts-heading" className="space-y-2 rounded-xl border border-dashed border-border-strong p-4 text-sm">
      <h2 id="doubts-heading" className="flex items-center gap-1.5 font-semibold">
        <TriangleAlert size={16} aria-hidden="true" className="text-accent" />
        Проверьте: в тексте есть утверждения, которые расходятся с общепринятыми сведениями
      </h2>
      <ul className="space-y-2">
        {journey.doubts.map((doubt) => (
          <li key={doubt.claim}>
            <p>«{doubt.claim}»</p>
            <p className="text-muted">{doubt.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Route({ journey }: { journey: PublicJourney }) {
  return (
    <ol className="space-y-2">
      {journey.checkpoints.map((checkpoint, index) => (
        <li key={checkpoint.id} className="flex items-baseline gap-3 rounded-lg border border-border bg-surface p-3">
          <span className="text-sm font-semibold text-accent">{index + 1}</span>
          <span className="flex-1">{checkpoint.title}</span>
          <span className="shrink-0 text-sm text-muted tabular-nums">
            {checkpoint.exercises.length}{" "}
            {plural(checkpoint.exercises.length, ["упражнение", "упражнения", "упражнений"])} ·{" "}
            {formatTime(checkpointSeconds(checkpoint))}
          </span>
        </li>
      ))}
    </ol>
  );
}

function JourneyStart({ progress, dispatch }: { progress: JourneyProgress; dispatch: (action: JourneyAction) => void }) {
  const { journey } = progress;
  return (
    <div className="space-y-6">
      <Doubts journey={journey} />
      <section aria-labelledby="route-heading" className="space-y-3">
        <h2 id="route-heading" className="text-xl font-semibold">
          Маршрут
        </h2>
        <Route journey={journey} />
        <p className="text-sm text-muted">
          У каждого чекпоинта своё время. Оно тратится только на упражнения, не на конспекты и
          переходы, и не останавливается, если перезагрузить страницу. Когда время выйдет, ответы
          отправятся как есть. Подсказка — по кнопке в упражнении.
        </p>
        <p className="text-sm text-muted">
          {GROW_TEXT} Каждый чекпоинт — новая ветка сакуры, а в конце путешествия она зацветёт.
        </p>
      </section>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => dispatch({ type: "choose", mode: "study", now: Date.now() })} className={PRIMARY_BUTTON}>
          <BookOpen size={16} aria-hidden="true" />
          Сначала изучить конспекты
        </button>
        <button type="button" onClick={() => dispatch({ type: "choose", mode: "quiz", now: Date.now() })} className={SECONDARY_BUTTON}>
          <Zap size={16} aria-hidden="true" />
          Сразу проверить себя
        </button>
      </div>
    </div>
  );
}

// Все конспекты одной страницей, по порядку маршрута; время здесь не идёт
function JourneyStudy({ journey, dispatch }: { journey: PublicJourney; dispatch: (action: JourneyAction) => void }) {
  const first = journey.checkpoints[0];
  return (
    <div className="space-y-6">
      <Doubts journey={journey} />
      <h2 className="text-xl font-semibold">Конспекты</h2>
      <ol className="space-y-6">
        {journey.checkpoints.map((checkpoint, index) => (
          <li key={checkpoint.id} className="space-y-2">
            <h3 className="font-semibold">
              <span className="text-accent">{index + 1}.</span> {checkpoint.title}
            </h3>
            <p className="leading-relaxed">{checkpoint.summary}</p>
          </li>
        ))}
      </ol>
      <div className="space-y-2 rounded-xl border border-border bg-surface p-5">
        <p className="text-sm text-muted">
          Во время проверки конспекты не видны — каждый откроется в итоге своего чекпоинта.
        </p>
        <button type="button" onClick={() => dispatch({ type: "beginCheckpoint", index: 0, now: Date.now() })} className={PRIMARY_BUTTON}>
          Начать проверку: {first.title} · {formatTime(checkpointSeconds(first))}
        </button>
      </div>
    </div>
  );
}

// Конец путешествия: сакура в цвету, очки, достижения и коротко по чекпоинтам
// (подробный отчёт — отдельная итерация)
function JourneyFinish({ progress, dispatch }: { progress: JourneyProgress; dispatch: (action: JourneyAction) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const game = useMemo(() => computeGamification(progress), [progress]);
  const correct = Object.values(progress.outcomes).filter(isFullyCorrect).length;
  const exerciseCount = progress.journey.checkpoints.reduce((sum, c) => sum + c.exercises.length, 0);

  return (
    <div className="space-y-4">
      <h2 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-xl font-semibold outline-none">
        <Flag size={20} aria-hidden="true" className="text-accent" />
        Путешествие пройдено · {pointsText(game.total)}
      </h2>
      <div className="flex flex-wrap items-start gap-6 rounded-xl border border-border bg-surface p-5">
        <Sakura leaves={game.leaves} started={game.startedCheckpoints} bloom className="w-40 shrink-0" />
        <div className="min-w-60 flex-1 space-y-3">
          <p className="text-sm text-muted tabular-nums">
            Верно {correct} из {exerciseCount} · лучшая серия {game.bestStreak}
          </p>
          <AchievementList achievements={game.achievements} />
        </div>
      </div>
      <ol className="space-y-2">
        {progress.journey.checkpoints.map((checkpoint, index) => {
          const outcomes = checkpoint.exercises.map(({ exercise }) => progress.outcomes[exercise.id]);
          const correct = outcomes.filter((outcome) => outcome !== undefined && isFullyCorrect(outcome)).length;
          const timeLeft = progress.runs[checkpoint.id]?.timeLeftSec ?? 0;
          return (
            <li key={checkpoint.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-border bg-surface p-3">
              <span className="text-sm font-semibold text-accent">{index + 1}</span>
              <span className="flex-1">{checkpoint.title}</span>
              <span className="text-sm text-muted tabular-nums">
                верно {correct} из {outcomes.length} ·{" "}
                {timeLeft > 0 ? `осталось ${formatTime(timeLeft)}` : "время вышло"} ·{" "}
                {pointsText(game.checkpoints[index]?.total ?? 0)}
              </span>
            </li>
          );
        })}
      </ol>
      <button type="button" onClick={() => dispatch({ type: "discard" })} className={PRIMARY_BUTTON}>
        Новое путешествие
      </button>
    </div>
  );
}

// Три достижения, связанные с обучением; неполученные — приглушены, с причиной
function AchievementList({ achievements }: { achievements: Achievements }) {
  const { cleanCheckpoints, calibration, onTime } = achievements;
  const items = [
    {
      Icon: CircleCheck,
      title: "Чистый чекпоинт",
      earned: cleanCheckpoints.length > 0,
      note:
        cleanCheckpoints.length > 0
          ? `${plural(cleanCheckpoints.length, ["Чекпоинт", "Чекпоинты", "Чекпоинты"])} ${cleanCheckpoints.join(", ")}: всё верно с первой попытки, без подсказок`
          : "Нет чекпоинта, где всё верно с первой попытки и без подсказок",
    },
    {
      Icon: Target,
      title: "Точная калибровка",
      earned: typeof calibration === "object" && calibration !== null && calibration.earned,
      note: !calibration
        ? "Калибровки уверенности не было"
        : calibration === "skipped"
          ? "Калибровка уверенности осталась без оценки"
          : calibration.earned
          ? "Когда вы были уверены, вы были правы"
          : calibration.confidentErrors > 0
            ? `Уверенных ошибок: ${calibration.confidentErrors} из ${calibration.total}`
            : "Уверенных верных ответов меньше половины",
    },
    {
      Icon: AlarmClockCheck,
      title: "Всё в срок",
      earned: onTime === true,
      note: onTime
        ? "Все чекпоинты закончены до конца времени"
        : "Нужно закончить каждый чекпоинт до конца времени и ответить верно хотя бы на половину",
    },
  ];
  return (
    <ul className="space-y-2 text-sm">
      {items.map(({ Icon, title, earned, note }) => (
        <li key={title} className="flex items-start gap-2 border-t border-border pt-2">
          <Icon size={18} aria-hidden="true" className={`mt-0.5 shrink-0 ${earned ? "text-accent" : "text-subtle"}`} />
          <div>
            <p className={earned ? "font-medium" : "font-medium text-muted"}>
              {title}
              {!earned && " — не получено"}
            </p>
            <p className="text-muted">{note}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
