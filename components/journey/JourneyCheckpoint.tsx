"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CircleCheck, Clock, Flag, TriangleAlert } from "lucide-react";
import { ExerciseView } from "@/components/exercises/ExerciseView";
import { plural } from "@/lib/plural";
import { checkpointSeconds, formatTime } from "@/lib/journey/timing";
import type { CheckResult } from "@/lib/exercises/types";
import type { PublicCheckpoint } from "@/lib/journey/types";
import { AnswerRecord, typeLabel } from "./AnswerRecord";
import { checkJourneyAnswer, fetchHint, fetchSkipExplanation } from "./api";
import { CheckpointTimer } from "./CheckpointTimer";
import {
  computeGamification,
  factorText,
  isFullyCorrect,
  HINT_FACTOR,
  SECOND_ATTEMPT_FACTOR,
  STREAK_FACTOR,
  type CheckpointPoints,
  type ExercisePoints,
} from "./gamification";
import { CompanionAside, GROW_TEXT, MiniSakura, pointsText, ScoreLine } from "./JourneyCompanion";
import { Sakura } from "./Sakura";
import { JourneyExerciseContext, type JourneyExerciseApi } from "./JourneyExerciseContext";
import {
  isCheckpointDone,
  type CalibrationMark,
  type ExerciseOutcome,
  type JourneyAction,
  type JourneyProgress,
} from "./state";

// Чекпоинт путешествия: все его упражнения сразу под липкой полосой времени.
// Каждое упражнение проверяется сразу; когда все получили итог, время останавливается
// и внизу появляется итог чекпоинта с очками и переходом к следующему. Когда время вышло,
// ответы отправляются как есть (см. finalizer в useExercise). Пока ИИ оценивает
// свободный ответ или калибровку, время стоит: момент окончания сдвигается на паузу.
// Рядом — сакура и счёт (JourneyCompanion.tsx).

type JourneyCheckpointProps = {
  progress: JourneyProgress;
  index: number;
  dispatch: (action: JourneyAction) => void;
};

export function JourneyCheckpoint({ progress, index, dispatch }: JourneyCheckpointProps) {
  const { journey, sealed } = progress;
  const checkpoint = journey.checkpoints[index];
  const run = progress.runs[checkpoint.id];
  const deadline = run?.deadline ?? 0;
  const totalSec = checkpointSeconds(checkpoint);
  const isDone = isCheckpointDone(progress, index);

  // Вышло ли время. Остаток не хранится, а считается из момента окончания: так
  // перезагрузка страницы не даёт лишнего времени. Секунды на экране обновляет
  // сам CheckpointTimer — упражнения не перерисовываются каждую секунду
  const [isTimeUp, setTimeUp] = useState(() => Date.now() >= deadline);
  // Пауза, пока ИИ оценивает ответ: момент её начала (null — паузы нет). Оценок может
  // идти несколько сразу — пауза длится, пока не закончится последняя.
  // В localStorage пауза не хранится: перезагрузка обрывает оценку, и время идёт как обычно
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const pause = useRef({ count: 0, since: 0 });
  useEffect(() => {
    if (isTimeUp || isDone || pausedAt !== null) return;
    const timer = setTimeout(() => setTimeUp(true), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [isTimeUp, isDone, deadline, pausedAt]);

  // Упражнения, у которых итог был ещё до открытия страницы (страницу перезагрузили):
  // показываются компактной записью — вопрос, ответ, разбор, как в итогах путешествия
  const [restored] = useState(
    () =>
      new Set(
        checkpoint.exercises
          .map(({ exercise }) => exercise.id)
          .filter((id) => Object.hasOwn(progress.outcomes, id)),
      ),
  );
  // Чекпоинт закончен ещё до открытия страницы — фокус на итог не переводим
  const [wasDoneOnOpen] = useState(isDone);

  // Ответ, пришедший после ухода с чекпоинта («Мои путешествия» во время проверки),
  // не записывается: id упражнений в разных путешествиях совпадают
  const isMounted = useRef(false);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Что сделать с каждым упражнением, когда время выйдет; от них ничего не рисуется.
  // Каждая функция возвращает true, если всё отправлено
  const finalizers = useRef(new Map<string, () => Promise<boolean>>());
  const registerFinalizer = useCallback((exerciseId: string, finalize: () => Promise<boolean>) => {
    finalizers.current.set(exerciseId, finalize);
    return () => {
      if (finalizers.current.get(exerciseId) === finalize) finalizers.current.delete(exerciseId);
    };
  }, []);
  // Время вышло, но часть ответов не дошла (нет сети)
  const [finalizeFailed, setFinalizeFailed] = useState(false);
  // Отправка уже идёт — повторное нажатие её не запускает
  const isFinalizing = useRef(false);
  // Свободные ответы: запечатанная оценка последней попытки — с ней «Показать ответ»
  // не обращается к модели снова (сервер проверит, что она от того же ответа)
  const evaluations = useRef(new Map<string, string>());

  const finalizeAll = useCallback(() => {
    if (isFinalizing.current) return;
    isFinalizing.current = true;
    void Promise.allSettled([...finalizers.current.values()].map((finalize) => finalize())).then(
      (results) => {
        isFinalizing.current = false;
        setFinalizeFailed(results.some((r) => r.status === "rejected" || r.value !== true));
      },
    );
  }, []);

  function retryFinalize() {
    setFinalizeFailed(false);
    finalizeAll();
  }

  // Последние значения для эффектов и запросов. timeUpRef — чтобы readTimeUp()
  // совпадал с isTimeUp, даже если таймер сработал чуть раньше часов;
  // deadlineRef сдвигается сразу в конце паузы, не дожидаясь перерисовки
  const isDoneRef = useRef(isDone);
  const timeUpRef = useRef(isTimeUp);
  const deadlineRef = useRef(deadline);
  useEffect(() => {
    isDoneRef.current = isDone;
    timeUpRef.current = isTimeUp;
    deadlineRef.current = deadline;
  });

  // На паузе время не выходит
  const readTimeUp = useCallback(
    () => timeUpRef.current || (pause.current.count === 0 && Date.now() >= deadlineRef.current),
    [],
  );

  const beginPause = useCallback(() => {
    if (pause.current.count++ > 0) return;
    pause.current.since = Date.now();
    setPausedAt(pause.current.since);
  }, []);

  const endPause = useCallback(() => {
    if (--pause.current.count > 0) return;
    const ms = Date.now() - pause.current.since;
    deadlineRef.current += ms;
    setPausedAt(null);
    // Сдвиг записывается раньше итога упражнения — остаток времени чекпоинта считается уже с ним
    if (isMounted.current) dispatch({ type: "extendDeadline", checkpointId: checkpoint.id, ms });
  }, [dispatch, checkpoint.id]);

  // Только в момент, когда время вышло (или страница открыта уже после этого)
  useEffect(() => {
    if (isTimeUp && !isDoneRef.current) finalizeAll();
  }, [isTimeUp, finalizeAll]);

  const api = useMemo<JourneyExerciseApi>(() => {
    const findExercise = (id: string) =>
      checkpoint.exercises.find(({ exercise }) => exercise.id === id)?.exercise;
    const safeDispatch = (action: JourneyAction) => {
      if (isMounted.current) dispatch(action);
    };
    return {
      maxAttempts: (id) => {
        const type = findExercise(id)?.type;
        return type === "true-false" || type === "calibration" ? 1 : 2;
      },
      attemptsUsed: (id) => progress.attempts[id]?.count ?? 0,
      check: async (id, answer, reveal) => {
        const type = findExercise(id)?.type;
        if (type !== "calibration" && type !== "free-answer") return checkJourneyAnswer(sealed, id, answer, reveal);
        // Ответ оценивает ИИ — время стоит (если оно ещё идёт)
        const pauses = !readTimeUp() && !isDoneRef.current;
        if (pauses) beginPause();
        try {
          // Калибровку тоже оценивает модель — с её тайм-аутом; запечатанной оценки у неё нет
          if (type === "calibration") return await checkJourneyAnswer(sealed, id, answer, reveal, {});
          const { evaluation, ...result } = await checkJourneyAnswer(sealed, id, answer, reveal, {
            evaluation: evaluations.current.get(id),
          });
          if (evaluation) evaluations.current.set(id, evaluation);
          return result;
        } finally {
          if (pauses) endPause();
        }
      },
      recordCheck: (id, result, attempt, answer) =>
        safeDispatch({
          type: "checked",
          exerciseId: id,
          attempt,
          score: result.score,
          verdict: result.verdict,
          explanation: result.review?.explanation,
          calibration: calibrationMarks(result),
          answer,
          details: result.review?.details,
          now: Date.now(),
        }),
      skip: async (id, unrated = false, answer) => {
        const explanation = await fetchSkipExplanation(sealed, id);
        safeDispatch({ type: "skipped", exerciseId: id, explanation, unrated, answer, now: Date.now() });
      },
      outcomeFor: (id) => progress.outcomes[id],
      hintFor: (id) => progress.hints[id],
      requestHint: async (id) => {
        const hint = await fetchHint(sealed, id);
        safeDispatch({ type: "hint", exerciseId: id, hint });
      },
      isTimeUp,
      readTimeUp,
      registerFinalizer,
    };
  }, [checkpoint, progress.attempts, progress.outcomes, progress.hints, sealed, dispatch, isTimeUp, readTimeUp, beginPause, endPause, registerFinalizer]);

  const game = useMemo(() => computeGamification(progress), [progress]);

  const answered = checkpoint.exercises.filter(({ exercise }) =>
    Object.hasOwn(progress.outcomes, exercise.id),
  ).length;
  const total = checkpoint.exercises.length;
  const checkpointCount = journey.checkpoints.length;

  return (
    <div className="relative space-y-4">
      <div>
        <p className="text-sm text-muted">
          Чекпоинт {index + 1} из {checkpointCount}
        </p>
        <h2 className="text-2xl font-semibold">{checkpoint.title}</h2>
      </div>

      <CheckpointTimer
        label={`Готово ${answered} из ${total}`}
        deadline={deadline}
        totalSec={totalSec}
        stoppedAtSec={isDone ? (run?.timeLeftSec ?? 0) : null}
        pausedAt={pausedAt}
        companion={<MiniSakura game={game} />}
        score={<ScoreLine game={game} />}
      />

      <JourneyExerciseContext.Provider value={api}>
        {checkpoint.exercises.map(({ exercise }) =>
          restored.has(exercise.id) || isUnanswered(progress.outcomes[exercise.id]) ? (
            <AnswerRecord
              key={exercise.id}
              exercise={exercise}
              outcome={progress.outcomes[exercise.id]}
              hint={Object.hasOwn(progress.hints, exercise.id)}
              className="my-8"
            />
          ) : (
            <ExerciseView key={exercise.id} exercise={exercise} />
          ),
        )}
      </JourneyExerciseContext.Provider>

      {isTimeUp && !isDone && (
        <div className="space-y-2 rounded-xl border border-border bg-surface p-5 text-sm">
          {finalizeFailed ? (
            <>
              <p role="alert" className="flex items-center gap-1.5">
                <TriangleAlert size={16} aria-hidden="true" className="text-muted" />
                Время вышло, но часть ответов не удалось отправить.
              </p>
              <button
                type="button"
                onClick={retryFinalize}
                className="rounded-md bg-accent-fill px-4 py-2 font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
              >
                Отправить ещё раз
              </button>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-muted">
              <Clock size={16} aria-hidden="true" />
              Время вышло — отправляю ответы…
            </p>
          )}
        </div>
      )}

      {isDone && (
        <CheckpointSummary
          progress={progress}
          index={index}
          checkpoint={checkpoint}
          points={game.checkpoints[index]}
          sakura={<Sakura leaves={game.leaves} started={game.startedCheckpoints} bloom={false} className="w-full" />}
          dispatch={dispatch}
          focusOnShow={!wasDoneOnOpen}
        />
      )}

      {/* Колонка справа стоит в разметке последней: диктор сначала читает чекпоинт */}
      <CompanionAside game={game} />
    </div>
  );
}

// Время вышло, а ответа не было: карточка упражнения сменяется компактной записью
// («Время вышло — ответа нет» и объяснение), как после перезагрузки страницы, —
// иначе оставались бы инструкции и пустые поля, с которыми уже ничего не сделать
function isUnanswered(outcome: ExerciseOutcome | undefined): boolean {
  return outcome !== undefined && outcome.skipped && outcome.answer === undefined;
}

// Калибровка: пары «уверенность — верно ли» из разбора, в порядке вопросов
function calibrationMarks(result: CheckResult): CalibrationMark[] | undefined {
  const details = result.review?.details;
  if (details?.type !== "calibration") return undefined;
  return Object.values(details.items).map(({ confident, correct }) => ({ confident, correct }));
}

// Итог чекпоинта: сколько верно, сколько времени осталось, разбор очков, конспект
// и переход дальше. Сакура здесь — только на узком экране: на широком она в колонке рядом
function CheckpointSummary({
  progress,
  index,
  checkpoint,
  points,
  sakura,
  dispatch,
  focusOnShow,
}: {
  progress: JourneyProgress;
  index: number;
  checkpoint: PublicCheckpoint;
  points: CheckpointPoints;
  sakura: ReactNode;
  dispatch: (action: JourneyAction) => void;
  focusOnShow: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Итог появляется под упражнениями — переводим на него фокус
  // (кроме открытия страницы с уже пройденным чекпоинтом: тогда страница открывается сверху)
  useEffect(() => {
    if (focusOnShow) headingRef.current?.focus();
  }, [focusOnShow]);

  const outcomes = checkpoint.exercises.map(({ exercise }) => progress.outcomes[exercise.id]);
  const correct = outcomes.filter((outcome) => outcome !== undefined && isFullyCorrect(outcome)).length;
  const timeLeft = progress.runs[checkpoint.id]?.timeLeftSec ?? 0;
  const next = progress.journey.checkpoints[index + 1];

  return (
    <section className="space-y-4 rounded-xl border border-accent bg-surface p-5">
      <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold outline-none">
        <Flag size={20} aria-hidden="true" className="text-accent" />
        Чекпоинт {index + 1} завершён · +{pointsText(points.total)}
      </h3>
      {/* Сакура с фразой: на телефоне — в строку (фраза справа от дерева), чтобы под деревом
          не оставался узкий столбик текста; от sm — колонкой слева от счёта */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex w-full items-center gap-3 sm:w-36 sm:shrink-0 sm:flex-col sm:items-stretch sm:gap-1 xl:hidden xl:search-open:flex">
          <div className="w-28 shrink-0 sm:w-full">{sakura}</div>
          <p className="text-xs leading-relaxed text-muted">{GROW_TEXT}</p>
        </div>
        <div className="min-w-60 flex-1 space-y-3 text-sm">
          <div className="space-y-1">
            <p>
              Верно {correct} из {outcomes.length}{" "}
              {plural(outcomes.length, ["упражнения", "упражнений", "упражнений"])}
            </p>
            <p className="text-muted">
              {timeLeft > 0 ? `Осталось времени: ${formatTime(timeLeft)}` : "Время вышло"}
            </p>
          </div>
          {points.clean && (
            <p className="flex items-start gap-1.5">
              <CircleCheck size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
              <span>
                <span className="font-medium">Чистый чекпоинт</span>
                <span className="text-muted"> — всё верно с первой попытки, без подсказок</span>
              </span>
            </p>
          )}
          <PointsTable checkpoint={checkpoint} points={points} />
        </div>
      </div>

      {/* В режиме «сразу проверить» конспект здесь показывается впервые — раскрыт */}
      <details open={progress.mode === "quiz"} className="rounded-lg bg-background p-3 text-sm">
        <summary className="cursor-pointer font-medium">Конспект: {checkpoint.title}</summary>
        <p className="mt-2 leading-relaxed">{checkpoint.summary}</p>
      </details>

      {next ? (
        <button
          type="button"
          onClick={() => dispatch({ type: "beginCheckpoint", index: index + 1, now: Date.now() })}
          className="inline-flex items-center gap-2 rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
        >
          Чекпоинт {index + 2}: {next.title} · {formatTime(checkpointSeconds(next))}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => dispatch({ type: "finish", now: Date.now() })}
          className="inline-flex items-center gap-2 rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
        >
          Завершить путешествие
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}

// Разбор очков: за что сколько
function PointsTable({ checkpoint, points }: { checkpoint: PublicCheckpoint; points: CheckpointPoints }) {
  const byId = new Map(points.exercises.map((e) => [e.exerciseId, e]));
  return (
    <table className="w-full tabular-nums">
      <caption className="sr-only">Очки за чекпоинт</caption>
      <tbody>
        {checkpoint.exercises.map(({ exercise }, n) => {
          const item = byId.get(exercise.id);
          const type = typeLabel(exercise);
          return (
            <tr key={exercise.id}>
              <td className="py-0.5 pr-2">
                Упражнение {n + 1}
                {type && ` · ${type.name}`}
                {item && <span className="text-muted">{factorsText(item)}</span>}
              </td>
              <td className="py-0.5 text-right">{item?.points ?? 0}</td>
            </tr>
          );
        })}
        <tr className="border-t border-border">
          <td className="py-0.5 pr-2">
            Бонус за время
            <span className="text-muted">
              {points.timeShare
                ? ` · осталось ${Math.round(points.timeShare * 100)}%`
                : " · время вышло"}
            </span>
          </td>
          <td className="py-0.5 text-right">+{points.bonus}</td>
        </tr>
        <tr className="font-medium">
          <td className="py-0.5 pr-2">Итого</td>
          <td className="py-0.5 text-right">{points.total}</td>
        </tr>
      </tbody>
    </table>
  );
}

function factorsText(item: ExercisePoints): string {
  const factors = [
    item.secondAttempt && `вторая попытка ${factorText(SECOND_ATTEMPT_FACTOR)}`,
    item.hint && `подсказка ${factorText(HINT_FACTOR)}`,
    item.streakBonus && `серия ${factorText(STREAK_FACTOR)}`,
  ].filter(Boolean);
  return factors.length > 0 ? ` · ${factors.join(", ")}` : "";
}
