import { checkpointSeconds } from "@/lib/journey/timing";
import type { PublicCheckpoint } from "@/lib/journey/types";
import type { CalibrationMark, ExerciseOutcome, JourneyProgress } from "./state";

// Очки, серия верных ответов, достижения и состояние сакуры. Ничего из этого не хранится:
// всё каждый раз считается из прогресса (итоги упражнений, открытые подсказки,
// остаток времени чекпоинтов), поэтому не может разойтись с ответами.
// Порядок ответов — порядок ключей в progress.outcomes: id упражнений вида «c1-2»
// не похожи на числа, а для таких ключей объект хранит порядок добавления.

// Упражнение, решённое полностью с первой попытки и без подсказки
const POINTS_PER_EXERCISE = 10;
// Вторая попытка и подсказка — множители: угадать со второй попытки (6) хуже,
// чем открыть подсказку и ответить верно (8)
export const SECOND_ATTEMPT_FACTOR = 0.6;
export const HINT_FACTOR = 0.8;
// После трёх верных ответов подряд очки следующих упражнений — ×1,5
export const STREAK_LENGTH = 3;
export const STREAK_FACTOR = 1.5;
// Бонус за время: очки чекпоинта × 0,25 × доля оставшегося времени. Бонус меньше
// цены одного упражнения, поэтому лишнее верное упражнение всегда важнее запаса времени
const TIME_BONUS_FACTOR = 0.25;

// Множитель для текста: «×0,6»
export function factorText(factor: number): string {
  return `×${String(factor).replace(".", ",")}`;
}

export type ExercisePoints = {
  exerciseId: string;
  // Очки с множителем серии (округлено)
  points: number;
  secondAttempt: boolean;
  hint: boolean;
  streakBonus: boolean;
};

export type CheckpointPoints = {
  exercises: ExercisePoints[];
  earned: number;
  // Доля оставшегося времени (0–1) и бонус за неё; null — чекпоинт ещё не закончен
  timeShare: number | null;
  bonus: number;
  total: number;
  clean: boolean;
};

// Состояние листа сакуры: упражнение ещё впереди, верно, частично, ошибка
// или ошибка, которую «вылечил» более поздний верный ответ
export type LeafState = "pending" | "correct" | "partial" | "wilted" | "healed";

export type Gamification = {
  checkpoints: CheckpointPoints[];
  total: number;
  // Текущая серия и лучшая за путешествие
  streak: number;
  bestStreak: number;
  // Листья по чекпоинтам, в порядке упражнений
  leaves: LeafState[][];
  // Чекпоинты, которые уже начаты (на сакуре есть их ветка)
  startedCheckpoints: number;
  achievements: Achievements;
};

export type Achievements = {
  // Номера (с 1) чекпоинтов, где всё верно с первой попытки и без подсказок
  cleanCheckpoints: number[];
  // Калибровка: нет уверенных ошибок и хотя бы половина ответов — уверенные и верные.
  // "skipped" — калибровка без оценки (время вышло или ИИ недоступен); null — её ещё не было
  calibration: { earned: boolean; confidentErrors: number; total: number } | "skipped" | null;
  // Все чекпоинты закончены до конца времени, и в каждом верна хотя бы половина
  // упражнений. null — путешествие ещё не пройдено
  onTime: boolean | null;
};

// Верен ли ответ полностью. У калибровки — все ответы верны, сомнения не в счёт:
// честное «Сомневаюсь» не ошибка
export function isFullyCorrect(outcome: ExerciseOutcome): boolean {
  if (outcome.skipped) return false;
  if (outcome.calibration) return outcome.calibration.every((mark) => mark.correct);
  return outcome.verdict === "correct";
}

// Как ответ меняет серию: число — продолжить на столько шагов, "reset" — обнулить,
// null — не менять. Калибровка — по вопросам: уверенно и верно — шаг серии,
// сомнение серию не меняет (честность не наказывается), уверенная ошибка — обнуляет.
// Остальные типы: серию продолжает только «Верно» с первой попытки; подсказка серию не рвёт
// (она и так стоит очков). Свободный ответ, пропущенный без оценки, потому что ИИ
// недоступен, серию не меняет — человек тут ни при чём
function streakStep(outcome: ExerciseOutcome): number | "reset" | null {
  if (outcome.unrated && outcome.skipped) return null;
  if (outcome.skipped) return "reset";
  if (outcome.calibration) return calibrationStep(outcome.calibration);
  return outcome.verdict === "correct" && outcome.attempts === 1 ? 1 : "reset";
}

function calibrationStep(marks: CalibrationMark[]): number | "reset" {
  let steps = 0;
  for (const mark of marks) {
    if (mark.confident && !mark.correct) return "reset";
    if (mark.confident) steps += 1;
  }
  return steps;
}

export function computeGamification(progress: JourneyProgress): Gamification {
  const { journey, outcomes, hints, runs } = progress;

  // Очки упражнений и серия — в порядке ответов
  const pointsById = new Map<string, ExercisePoints>();
  let streak = 0;
  let bestStreak = 0;
  for (const [exerciseId, outcome] of Object.entries(outcomes)) {
    const secondAttempt = outcome.attempts >= 2;
    const hint = Object.hasOwn(hints, exerciseId);
    const raw =
      POINTS_PER_EXERCISE * outcome.score * (secondAttempt ? SECOND_ATTEMPT_FACTOR : 1) * (hint ? HINT_FACTOR : 1);
    const streakBonus = streak >= STREAK_LENGTH && raw > 0;
    pointsById.set(exerciseId, {
      exerciseId,
      points: Math.round(streakBonus ? raw * STREAK_FACTOR : raw),
      secondAttempt,
      hint,
      streakBonus,
    });
    const step = streakStep(outcome);
    if (step === "reset") streak = 0;
    else if (step !== null) streak += step;
    bestStreak = Math.max(bestStreak, streak);
  }

  const checkpoints = journey.checkpoints.map((checkpoint) =>
    checkpointPoints(checkpoint, progress, pointsById),
  );

  return {
    checkpoints,
    total: checkpoints.reduce((sum, c) => sum + c.total, 0),
    streak,
    bestStreak,
    leaves: computeLeaves(progress),
    startedCheckpoints: journey.checkpoints.filter((c) => Object.hasOwn(runs, c.id)).length,
    achievements: computeAchievements(progress, checkpoints),
  };
}

function checkpointPoints(
  checkpoint: PublicCheckpoint,
  progress: JourneyProgress,
  pointsById: Map<string, ExercisePoints>,
): CheckpointPoints {
  const exercises = checkpoint.exercises.flatMap(({ exercise }) => pointsById.get(exercise.id) ?? []);
  const earned = exercises.reduce((sum, e) => sum + e.points, 0);
  const timeLeftSec = progress.runs[checkpoint.id]?.timeLeftSec;
  const timeShare =
    timeLeftSec === undefined ? null : Math.min(1, timeLeftSec / checkpointSeconds(checkpoint));
  const bonus = timeShare === null ? 0 : Math.round(earned * TIME_BONUS_FACTOR * timeShare);
  // Чистый чекпоинт: закончен, всё верно с первой попытки и без подсказок
  const clean =
    timeShare !== null &&
    checkpoint.exercises.every(({ exercise }) => {
      const outcome = progress.outcomes[exercise.id];
      return (
        outcome !== undefined &&
        isFullyCorrect(outcome) &&
        outcome.attempts === 1 &&
        !Object.hasOwn(progress.hints, exercise.id)
      );
    });
  return { exercises, earned, timeShare, bonus, total: earned + bonus, clean };
}

// Листья сакуры: ошибка — жёлтый лист; каждый следующий полностью верный ответ
// «лечит» самую раннюю ещё жёлтую
function computeLeaves(progress: JourneyProgress): LeafState[][] {
  const states = new Map<string, LeafState>();
  const wilted: string[] = [];
  for (const [exerciseId, outcome] of Object.entries(progress.outcomes)) {
    if (isFullyCorrect(outcome)) {
      states.set(exerciseId, "correct");
      const healed = wilted.shift();
      if (healed) states.set(healed, "healed");
    } else if (outcome.skipped && outcome.unrated) {
      // ИИ не смог оценить — не ошибка человека
      states.set(exerciseId, "partial");
    } else if (outcome.verdict === "partial" && !outcome.skipped) {
      states.set(exerciseId, "partial");
    } else {
      states.set(exerciseId, "wilted");
      wilted.push(exerciseId);
    }
  }
  return progress.journey.checkpoints.map((checkpoint) =>
    checkpoint.exercises.map(({ exercise }) => states.get(exercise.id) ?? "pending"),
  );
}

function computeAchievements(progress: JourneyProgress, checkpoints: CheckpointPoints[]): Achievements {
  const cleanCheckpoints = checkpoints.flatMap((c, index) => (c.clean ? [index + 1] : []));

  // Калибровка в путешествии одна; итог без отметок — её пропустили без оценки
  const calibrationId = progress.journey.checkpoints
    .flatMap((checkpoint) => checkpoint.exercises)
    .find(({ exercise }) => exercise.type === "calibration")?.exercise.id;
  const calibrationOutcome = calibrationId === undefined ? undefined : progress.outcomes[calibrationId];
  const marks = calibrationOutcome?.calibration;
  let calibration: Achievements["calibration"] = null;
  if (calibrationOutcome && !marks) calibration = "skipped";
  else if (marks) {
    calibration = {
      earned:
        marks.every((mark) => !mark.confident || mark.correct) &&
        marks.filter((mark) => mark.confident && mark.correct).length >= marks.length / 2,
      confidentErrors: marks.filter((mark) => mark.confident && !mark.correct).length,
      total: marks.length,
    };
  }

  const finished = progress.journey.checkpoints.every((c) => progress.runs[c.id]?.timeLeftSec !== undefined);
  const onTime = finished
    ? progress.journey.checkpoints.every((checkpoint) => {
        const correct = checkpoint.exercises.filter(({ exercise }) => {
          const outcome = progress.outcomes[exercise.id];
          return outcome !== undefined && isFullyCorrect(outcome);
        }).length;
        return (progress.runs[checkpoint.id]?.timeLeftSec ?? 0) > 0 && correct >= checkpoint.exercises.length / 2;
      })
    : null;

  return { cleanCheckpoints, calibration, onTime };
}
