"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Clock, Flag, TriangleAlert } from "lucide-react";
import { ExerciseView } from "@/components/exercises/ExerciseView";
import { VERDICTS } from "@/components/exercises/ExerciseShell";
import { plural } from "@/lib/plural";
import { checkpointSeconds, formatTime } from "@/lib/journey/timing";
import type { PublicCheckpoint } from "@/lib/journey/types";
import { checkJourneyAnswer, fetchHint, fetchSkipExplanation } from "./api";
import { CheckpointTimer } from "./CheckpointTimer";
import { skippedLabel } from "./outcomeLabels";
import { JourneyExerciseContext, type JourneyExerciseApi } from "./JourneyExerciseContext";
import {
  isCheckpointDone,
  type ExerciseOutcome,
  type JourneyAction,
  type JourneyProgress,
} from "./state";

// Чекпоинт путешествия: все его упражнения сразу под липкой полосой времени.
// Каждое упражнение проверяется сразу; когда все получили итог, время останавливается
// и внизу появляется итог чекпоинта с переходом к следующему. Когда время вышло,
// ответы отправляются как есть (см. finalizer в useExercise).

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
  useEffect(() => {
    if (isTimeUp || isDone) return;
    const timer = setTimeout(() => setTimeUp(true), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [isTimeUp, isDone, deadline]);

  // Упражнения, у которых итог был ещё до открытия страницы (страницу перезагрузили):
  // их ответ не сохраняется, поэтому показываем итог и объяснение
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

  // Ответ, пришедший после ухода с чекпоинта («Новое путешествие» во время проверки),
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
  // совпадал с isTimeUp, даже если таймер сработал чуть раньше часов
  const isDoneRef = useRef(isDone);
  const timeUpRef = useRef(isTimeUp);
  useEffect(() => {
    isDoneRef.current = isDone;
    timeUpRef.current = isTimeUp;
  });

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
      maxAttempts: (id) => (findExercise(id)?.type === "true-false" ? 1 : 2),
      attemptsUsed: (id) => progress.attempts[id]?.count ?? 0,
      check: async (id, answer, reveal) => {
        if (findExercise(id)?.type !== "free-answer") {
          return checkJourneyAnswer(sealed, id, answer, reveal);
        }
        const { evaluation, ...result } = await checkJourneyAnswer(sealed, id, answer, reveal, {
          evaluation: evaluations.current.get(id),
        });
        if (evaluation) evaluations.current.set(id, evaluation);
        return result;
      },
      recordCheck: (id, result, attempt) =>
        safeDispatch({
          type: "checked",
          exerciseId: id,
          attempt,
          score: result.score,
          verdict: result.verdict,
          explanation: result.review?.explanation,
          now: Date.now(),
        }),
      skip: async (id, unrated = false) => {
        const explanation = await fetchSkipExplanation(sealed, id);
        safeDispatch({ type: "skipped", exerciseId: id, explanation, unrated, now: Date.now() });
      },
      outcomeFor: (id) => progress.outcomes[id],
      hintFor: (id) => progress.hints[id],
      requestHint: async (id) => {
        const hint = await fetchHint(sealed, id);
        safeDispatch({ type: "hint", exerciseId: id, hint });
      },
      isTimeUp,
      readTimeUp: () => timeUpRef.current || Date.now() >= deadline,
      registerFinalizer,
    };
  }, [checkpoint, progress.attempts, progress.outcomes, progress.hints, sealed, dispatch, isTimeUp, deadline, registerFinalizer]);

  const answered = checkpoint.exercises.filter(({ exercise }) =>
    Object.hasOwn(progress.outcomes, exercise.id),
  ).length;
  const total = checkpoint.exercises.length;
  const checkpointCount = journey.checkpoints.length;

  return (
    <div className="space-y-4">
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
      />

      <JourneyExerciseContext.Provider value={api}>
        {checkpoint.exercises.map(({ exercise }) =>
          restored.has(exercise.id) ? (
            <RestoredExercise
              key={exercise.id}
              question={exercise.question}
              outcome={progress.outcomes[exercise.id]}
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
          dispatch={dispatch}
          focusOnShow={!wasDoneOnOpen}
        />
      )}
    </div>
  );
}

// Упражнение с итогом, полученным до перезагрузки страницы
function RestoredExercise({ question, outcome }: { question: string; outcome: ExerciseOutcome }) {
  const verdict = VERDICTS[outcome.verdict];
  return (
    <section className="my-8 rounded-xl border border-border bg-surface p-5 text-sm">
      <p className="text-base font-semibold">{question}</p>
      <p className={`mt-3 inline-flex items-center gap-1.5 font-semibold ${outcome.skipped ? "text-muted" : verdict.className}`}>
        {outcome.skipped ? (
          outcome.unrated ? <TriangleAlert size={18} aria-hidden="true" /> : <Clock size={18} aria-hidden="true" />
        ) : (
          <verdict.Icon size={18} aria-hidden="true" />
        )}
        {outcome.skipped ? skippedLabel(outcome) : verdict.label}
        {outcome.attempts > 1 && <span className="font-normal text-muted">· со второй попытки</span>}
      </p>
      {outcome.unrated && !outcome.skipped && (
        <p className="mt-1 text-muted">{skippedLabel(outcome)}</p>
      )}
      {/* В объяснении свободного ответа образец — отдельным абзацем */}
      <p className="mt-2 whitespace-pre-line text-muted">{outcome.explanation}</p>
    </section>
  );
}

// Итог чекпоинта: сколько верно, сколько времени осталось, конспект и переход дальше
function CheckpointSummary({
  progress,
  index,
  checkpoint,
  dispatch,
  focusOnShow,
}: {
  progress: JourneyProgress;
  index: number;
  checkpoint: PublicCheckpoint;
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
  const correct = outcomes.filter((outcome) => outcome?.verdict === "correct").length;
  const timeLeft = progress.runs[checkpoint.id]?.timeLeftSec ?? 0;
  const next = progress.journey.checkpoints[index + 1];

  return (
    <section className="space-y-4 rounded-xl border border-accent bg-surface p-5">
      <h3 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold outline-none">
        <Flag size={20} aria-hidden="true" className="text-accent" />
        Чекпоинт {index + 1} пройден
      </h3>
      <div className="space-y-1 text-sm">
        <p>
          Верно {correct} из {outcomes.length}{" "}
          {plural(outcomes.length, ["упражнения", "упражнений", "упражнений"])}
        </p>
        <p className="text-muted">
          {timeLeft > 0 ? `Осталось времени: ${formatTime(timeLeft)}` : "Время вышло"}
        </p>
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
          onClick={() => dispatch({ type: "finish" })}
          className="inline-flex items-center gap-2 rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
        >
          Завершить путешествие
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
