import type { Verdict } from "@/lib/exercises/types";
import { checkpointSeconds } from "@/lib/journey/timing";
import type { PublicJourney } from "@/lib/journey/types";

// Состояние прохождения путешествия. Всё хранится в браузере (localStorage):
// публичная часть путешествия, зашифрованное путешествие для проверки ответов
// и прогресс. Перезагрузка страницы прохождение не сбрасывает, а таймер хранит
// момент окончания, а не остаток — поэтому за время перезагрузки он не останавливается.

// «Сначала изучить конспекты» или «Сразу проверить себя»
export type JourneyMode = "study" | "quiz";

export type JourneyStage =
  | { kind: "start" }
  | { kind: "study" }
  | { kind: "checkpoint"; index: number }
  | { kind: "finished" };

// Итог упражнения — после него ответ уже не меняется
export type ExerciseOutcome = {
  score: number;
  verdict: Verdict;
  // С какой попытки (1 или 2; 0 — ответа не было): за вторую попытку в очках
  // будет понижающий коэффициент
  attempts: number;
  // Общее объяснение — для карточки после перезагрузки страницы
  explanation: string;
  // Время вышло, а ответа не было
  skipped: boolean;
  // Свободный ответ не удалось оценить (модель недоступна) — пропущен без оценки.
  // Если первая попытка была, засчитана она, иначе skipped = true
  unrated?: boolean;
};

// Прохождение чекпоинта: deadline — момент окончания времени (мс с 1970 г.);
// timeLeftSec — сколько секунд осталось, когда чекпоинт закончен (для бонуса в очках)
export type CheckpointRun = {
  deadline: number;
  timeLeftSec?: number;
};

export type AttemptRecord = { count: number; score: number; verdict: Verdict };

export type JourneyProgress = {
  version: 1;
  sealed: string;
  journey: PublicJourney;
  mode: JourneyMode | null;
  stage: JourneyStage;
  runs: Record<string, CheckpointRun>;
  // Сколько попыток уже потрачено на упражнение и итог последней — он станет итогом
  // упражнения, если вторую попытку не успели сделать
  attempts: Record<string, AttemptRecord>;
  outcomes: Record<string, ExerciseOutcome>;
  // Открытые подсказки
  hints: Record<string, string>;
};

export type JourneyAction =
  | { type: "load"; progress: JourneyProgress | null }
  | { type: "create"; journey: PublicJourney; sealed: string }
  | { type: "choose"; mode: JourneyMode; now: number }
  | { type: "beginCheckpoint"; index: number; now: number }
  // Ответ проверен. attempt — номер попытки или "same" (раскрытие ответа — не новая попытка);
  // explanation есть, только если сервер прислал разбор, — тогда это итог упражнения
  | {
      type: "checked";
      exerciseId: string;
      attempt: number | "same";
      score: number;
      verdict: Verdict;
      explanation?: string;
      now: number;
    }
  // Время вышло, а ответа нет; unrated — свободный ответ пропущен без оценки
  | { type: "skipped"; exerciseId: string; explanation: string; unrated: boolean; now: number }
  | { type: "hint"; exerciseId: string; hint: string }
  | { type: "finish" }
  | { type: "discard" };

// undefined — состояние ещё не прочитано из localStorage
export type JourneyState = JourneyProgress | null | undefined;

export function journeyReducer(state: JourneyState, action: JourneyAction): JourneyState {
  if (action.type === "load") return action.progress;
  if (action.type === "create") {
    return {
      version: 1,
      sealed: action.sealed,
      journey: action.journey,
      mode: null,
      stage: { kind: "start" },
      runs: {},
      attempts: {},
      outcomes: {},
      hints: {},
    };
  }
  if (action.type === "discard") return null;
  if (!state) return state;

  switch (action.type) {
    case "choose":
      return action.mode === "study"
        ? { ...state, mode: "study", stage: { kind: "study" } }
        : beginCheckpoint({ ...state, mode: "quiz" }, 0, action.now);
    case "beginCheckpoint":
      return beginCheckpoint(state, action.index, action.now);
    case "checked": {
      if (Object.hasOwn(state.outcomes, action.exerciseId)) return state;
      const count =
        action.attempt === "same" ? (state.attempts[action.exerciseId]?.count ?? 1) : action.attempt;
      const attempts = {
        ...state.attempts,
        [action.exerciseId]: { count, score: action.score, verdict: action.verdict },
      };
      const next = { ...state, attempts };
      if (action.explanation === undefined) return next;
      return addOutcome(next, action.exerciseId, action.now, {
        score: action.score,
        verdict: action.verdict,
        attempts: count,
        explanation: action.explanation,
        skipped: false,
      });
    }
    case "skipped": {
      if (Object.hasOwn(state.outcomes, action.exerciseId)) return state;
      // Первая попытка была, а вторую не успели — засчитывается первая
      const last = state.attempts[action.exerciseId];
      return addOutcome(state, action.exerciseId, action.now, {
        score: last?.score ?? 0,
        verdict: last?.verdict ?? "incorrect",
        attempts: last?.count ?? 0,
        explanation: action.explanation,
        skipped: last === undefined,
        ...(action.unrated && { unrated: true }),
      });
    }
    case "hint":
      return { ...state, hints: { ...state.hints, [action.exerciseId]: action.hint } };
    case "finish":
      return { ...state, stage: { kind: "finished" } };
  }
}

// Записывает итог упражнения; если это последнее упражнение чекпоинта — запоминает,
// сколько времени осталось
function addOutcome(
  state: JourneyProgress,
  exerciseId: string,
  now: number,
  outcome: ExerciseOutcome,
): JourneyProgress {
  const outcomes = { ...state.outcomes, [exerciseId]: outcome };
  const checkpoint = state.journey.checkpoints.find((c) =>
    c.exercises.some(({ exercise }) => exercise.id === exerciseId),
  );
  const run = checkpoint && state.runs[checkpoint.id];
  if (
    checkpoint &&
    run &&
    run.timeLeftSec === undefined &&
    checkpoint.exercises.every(({ exercise }) => Object.hasOwn(outcomes, exercise.id))
  ) {
    const timeLeftSec = Math.max(0, Math.floor((run.deadline - now) / 1000));
    return { ...state, outcomes, runs: { ...state.runs, [checkpoint.id]: { ...run, timeLeftSec } } };
  }
  return { ...state, outcomes };
}

// Таймер чекпоинта запускается, когда человек к нему перешёл; повторный запуск
// (например, двойное нажатие) время не продлевает
function beginCheckpoint(state: JourneyProgress, index: number, now: number): JourneyProgress {
  const checkpoint = state.journey.checkpoints[index];
  if (!checkpoint) return state;
  const runs = Object.hasOwn(state.runs, checkpoint.id)
    ? state.runs
    : { ...state.runs, [checkpoint.id]: { deadline: now + checkpointSeconds(checkpoint) * 1000 } };
  return { ...state, runs, stage: { kind: "checkpoint", index } };
}

// ---------- Хранение в localStorage ----------

const STORAGE_KEY = "journey-progress";

export function loadProgress(): JourneyProgress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const progress: unknown = JSON.parse(raw);
    // Сохранено старой версией страницы или испорчено — начинаем заново
    return isValidProgress(progress) ? progress : null;
  } catch {
    return null;
  }
}

// Типы упражнений, которые умеет показывать страница
const KNOWN_TYPES = new Set([
  "multiple-choice",
  "true-false",
  "fill-blank",
  "match-pairs",
  "order-steps",
  "costed-select",
  "prompt-rewrite",
  "free-answer",
]);

const VERDICTS = new Set(["correct", "partial", "incorrect"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function everyValue(value: unknown, check: (item: unknown) => boolean): boolean {
  return isRecord(value) && Object.values(value).every(check);
}

const isRun = (run: unknown) => isRecord(run) && typeof run.deadline === "number" && Number.isFinite(run.deadline);
const isAttempt = (a: unknown) =>
  isRecord(a) && typeof a.count === "number" && typeof a.score === "number" && VERDICTS.has(a.verdict as string);
const isOutcome = (o: unknown) =>
  isRecord(o) &&
  typeof o.attempts === "number" &&
  typeof o.score === "number" &&
  VERDICTS.has(o.verdict as string) &&
  typeof o.explanation === "string" &&
  typeof o.skipped === "boolean" &&
  (o.unrated === undefined || typeof o.unrated === "boolean");

// Проверка сохранённого прогресса: страница не должна падать на испорченных данных.
// Поля самих упражнений не проверяются — при смене формата повышается version
function isValidProgress(value: unknown): value is JourneyProgress {
  const p = value as JourneyProgress;
  if (!isRecord(p) || p.version !== 1 || typeof p.sealed !== "string") return false;
  if (!isRecord(p.journey) || typeof p.journey.title !== "string" || !Array.isArray(p.journey.doubts)) {
    return false;
  }
  const { checkpoints } = p.journey;
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) return false;
  const checkpointsOk = checkpoints.every(
    (c) =>
      isRecord(c) &&
      typeof c.id === "string" &&
      typeof c.title === "string" &&
      typeof c.summary === "string" &&
      Array.isArray(c.exercises) &&
      c.exercises.length > 0 &&
      c.exercises.every(
        (e) =>
          isRecord(e) &&
          isRecord(e.exercise) &&
          typeof e.exercise.id === "string" &&
          KNOWN_TYPES.has(e.exercise.type) &&
          [1, 2, 3].includes(e.difficulty),
      ),
  );
  if (
    !checkpointsOk ||
    !everyValue(p.runs, isRun) ||
    !everyValue(p.attempts, isAttempt) ||
    !everyValue(p.outcomes, isOutcome) ||
    !everyValue(p.hints, (hint) => typeof hint === "string")
  ) {
    return false;
  }
  const { stage } = p;
  if (!isRecord(stage)) return false;
  if (stage.kind === "checkpoint") {
    const checkpoint = checkpoints[stage.index];
    return checkpoint !== undefined && isRecord(p.runs[checkpoint.id]);
  }
  return stage.kind === "start" || stage.kind === "study" || stage.kind === "finished";
}

export function saveProgress(progress: JourneyProgress | null): void {
  try {
    if (progress) localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage недоступен или переполнен — прохождение работает, но не переживёт перезагрузку
  }
}

// Упражнения чекпоинта закончены — все с итогом
export function isCheckpointDone(progress: JourneyProgress, index: number): boolean {
  const checkpoint = progress.journey.checkpoints[index];
  return (
    checkpoint !== undefined &&
    checkpoint.exercises.every(({ exercise }) => Object.hasOwn(progress.outcomes, exercise.id))
  );
}
