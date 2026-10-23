"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlarmClockCheck, CircleCheck, Flag, Printer, Target } from "lucide-react";
import { plural } from "@/lib/plural";
import { formatTime } from "@/lib/journey/timing";
import { AnswerRecord } from "./AnswerRecord";
import { DiscardConfirm } from "./DiscardConfirm";
import { computeGamification, isFullyCorrect, type Achievements } from "./gamification";
import { pointsText } from "./JourneyCompanion";
import { Sakura } from "./Sakura";
import type { ExerciseOutcome, JourneyAction, JourneyProgress } from "./state";

// Итоги путешествия — экран в конце и он же печатная версия (печать и PDF — средствами
// браузера, стили печати в app/globals.css). Сверху карточка-итог: дата, очки, сакура
// в цвету, оценка от сакуры и достижения; затем «Что повторить»; затем по каждому
// чекпоинту — счёт, конспект и все ответы. Ничего не хранится отдельно: всё считается
// из прогресса, как и очки (gamification.ts). Запросов к модели нет.

const PRIMARY_BUTTON =
  "inline-flex items-center gap-2 rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover";
const SECONDARY_BUTTON =
  "inline-flex items-center gap-2 rounded-md border border-border-strong bg-background px-4 py-2 text-sm font-medium hover:bg-border";

// Оценка от сакуры — по среднему баллу за упражнения («частично» тоже в зачёт)
function companionVerdict(average: number): string {
  if (average >= 0.8) return "Ваши знания помогли сакуре зацвести в полную силу. Прекрасный результат.";
  if (average >= 0.5) {
    return "Сакура зацвела, но не на всех ветках. Есть куда стремиться — посмотрите «Что повторить».";
  }
  return "Сакуре пока не хватило света. Перечитайте конспекты и попробуйте новое путешествие по этой теме.";
}

// Ответ, который ИИ не смог оценить, — не ошибка человека: он не идёт ни в «Что повторить»,
// ни в средний балл (как и в серии)
const isUnratedSkip = (outcome: ExerciseOutcome) => outcome.unrated === true && outcome.skipped;
const isError = (outcome: ExerciseOutcome) => !isFullyCorrect(outcome) && !isUnratedSkip(outcome);

// null — оценённых ответов нет, судить не по чему
function averageScore(outcomes: ExerciseOutcome[]): number | null {
  const rated = outcomes.filter((outcome) => !isUnratedSkip(outcome));
  return rated.length === 0 ? null : rated.reduce((sum, outcome) => sum + outcome.score, 0) / rated.length;
}

const answerAnchor = (exerciseId: string) => `answer-${exerciseId}`;

export function JourneyReport({ progress, dispatch }: { progress: JourneyProgress; dispatch: (action: JourneyAction) => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const game = useMemo(() => computeGamification(progress), [progress]);
  const [isConfirming, setConfirming] = useState(false);
  const { journey } = progress;

  // По чекпоинтам: итоги упражнений, номера упражнений с ошибкой и средний балл
  const checkpoints = journey.checkpoints.map((checkpoint, index) => {
    const outcomes = checkpoint.exercises.flatMap(({ exercise }) => progress.outcomes[exercise.id] ?? []);
    const errors = checkpoint.exercises.flatMap(({ exercise }, n) => {
      const outcome = progress.outcomes[exercise.id];
      return outcome && isError(outcome) ? [n + 1] : [];
    });
    return { checkpoint, index, outcomes, errors, average: averageScore(outcomes) };
  });
  const allOutcomes = checkpoints.flatMap((c) => c.outcomes);
  const average = averageScore(allOutcomes);
  const correct = allOutcomes.filter(isFullyCorrect).length;
  const exerciseCount = journey.checkpoints.reduce((sum, c) => sum + c.exercises.length, 0);
  // Что повторить: чекпоинты с ошибками, от худшего к лучшему
  const toRepeat = checkpoints
    .filter((c) => c.errors.length > 0)
    .sort((a, b) => (a.average ?? 1) - (b.average ?? 1) || a.index - b.index);
  const finished = progress.finishedAt === undefined ? null : new Date(progress.finishedAt);
  const date =
    finished && !Number.isNaN(finished.getTime())
      ? finished.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
      : null;

  return (
    <div className="space-y-8">
      <section aria-labelledby="report-heading" className="space-y-4 rounded-xl border border-accent bg-surface p-5 break-inside-avoid">
        <div>
          <h2 id="report-heading" ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-xl font-semibold outline-none">
            <Flag size={20} aria-hidden="true" className="text-accent" />
            Итоги путешествия
          </h2>
          {date && <p className="mt-1 text-sm text-muted">{date}</p>}
        </div>
        <div className="flex flex-wrap items-start gap-6">
          <Sakura leaves={game.leaves} started={game.startedCheckpoints} bloom className="w-40 shrink-0" />
          <div className="min-w-60 flex-1 space-y-3">
            <div>
              <p className="text-2xl font-semibold tabular-nums">{pointsText(game.total)}</p>
              <p className="text-sm text-muted tabular-nums">
                Верно {correct} из {exerciseCount} · лучшая серия {game.bestStreak}
              </p>
            </div>
            {average !== null && <p>{companionVerdict(average)}</p>}
            <AchievementList achievements={game.achievements} />
          </div>
        </div>
      </section>

      {/* «Печать / PDF» видна и во время подтверждения: оно советует сначала сохранить итоги */}
      <div className="space-y-3 print:hidden">
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => window.print()} className={PRIMARY_BUTTON}>
            <Printer size={16} aria-hidden="true" />
            Печать / PDF
          </button>
          {!isConfirming && (
            <button type="button" onClick={() => setConfirming(true)} className={SECONDARY_BUTTON}>
              Новое путешествие
            </button>
          )}
        </div>
        {isConfirming && (
          <DiscardConfirm finished onConfirm={() => dispatch({ type: "discard" })} onCancel={() => setConfirming(false)} />
        )}
      </div>

      {/* Оценённых ответов нет вовсе (на деле не бывает: в путешествии есть упражнения без ИИ) —
          тогда ни похвалы, ни «Что повторить» */}
      {average === null ? null : toRepeat.length === 0 ? (
        <p className="flex items-center gap-2 font-medium">
          <CircleCheck size={18} aria-hidden="true" className="text-success" />
          Ошибок нет — вы хорошо разобрались в теме.
        </p>
      ) : (
        <section aria-labelledby="repeat-heading" className="space-y-3 rounded-xl border border-dashed border-border-strong p-5 break-inside-avoid">
          <h2 id="repeat-heading" className="text-xl font-semibold">
            Что повторить
          </h2>
          <ul className="space-y-3">
            {toRepeat.map(({ checkpoint, index, errors, average: checkpointAverage }) => (
              <li key={checkpoint.id} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                <p>
                  <span className="font-medium">
                    {index + 1}. {checkpoint.title}
                  </span>
                  <span className="text-muted tabular-nums"> · балл {Math.round((checkpointAverage ?? 0) * 100)}%</span>
                </p>
                <p className="text-muted">{checkpoint.concept}</p>
                <p className="text-sm">
                  Ошибки: {plural(errors.length, ["упражнение", "упражнения", "упражнения"])}{" "}
                  {errors.map((n, i) => (
                    <span key={n}>
                      {i > 0 && (i === errors.length - 1 ? " и " : ", ")}
                      <a href={`#${answerAnchor(checkpoint.exercises[n - 1].exercise.id)}`} className="text-accent underline-offset-2 hover:underline">
                        {n}
                      </a>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="answers-heading" className="space-y-8">
        <h2 id="answers-heading" className="text-xl font-semibold">
          Ответы по чекпоинтам
        </h2>
        {checkpoints.map(({ checkpoint, index, outcomes }) => {
          const timeLeft = progress.runs[checkpoint.id]?.timeLeftSec ?? 0;
          return (
            <section key={checkpoint.id} aria-labelledby={`report-${checkpoint.id}`} className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-2 break-after-avoid">
                <h3 id={`report-${checkpoint.id}`} className="text-lg font-semibold">
                  <span className="text-accent">{index + 1}</span> · {checkpoint.title}
                </h3>
                <p className="text-sm text-muted tabular-nums">
                  верно {outcomes.filter(isFullyCorrect).length} из {checkpoint.exercises.length} ·{" "}
                  {timeLeft > 0 ? `осталось ${formatTime(timeLeft)}` : "время вышло"} ·{" "}
                  {pointsText(game.checkpoints[index]?.total ?? 0)}
                </p>
              </div>
              {/* На экране конспект свёрнут, на печати — раскрыт (свёрнутый блок печатается свёрнутым) */}
              <details className="rounded-lg bg-surface p-3 text-sm print:hidden">
                <summary className="cursor-pointer font-medium">Конспект</summary>
                <p className="mt-2 leading-relaxed">{checkpoint.summary}</p>
              </details>
              <div className="hidden text-sm print:block">
                <p className="font-medium">Конспект</p>
                <p className="mt-1 leading-relaxed">{checkpoint.summary}</p>
              </div>
              {checkpoint.exercises.map(({ exercise }, n) => {
                const outcome = progress.outcomes[exercise.id];
                return (
                  outcome && (
                    <AnswerRecord
                      key={exercise.id}
                      id={answerAnchor(exercise.id)}
                      exercise={exercise}
                      outcome={outcome}
                      hint={Object.hasOwn(progress.hints, exercise.id)}
                      number={n + 1}
                    />
                  )
                );
              })}
            </section>
          );
        })}
      </section>
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
