import type { Verdict } from "@/lib/exercises/types";
import { checkpointSeconds } from "@/lib/journey/timing";
import { topicStatus, type TopicStatus } from "@/lib/progress/mastery";
import { computeGamification, isFullyCorrect } from "./gamification";
import { isCheckpointDone, type ExerciseOutcome, type JourneyProgress } from "./state";

// Итог путешествия для прогресса: по чекпоинтам — понятие, сколько верно из скольких,
// очки и усвоено ли понятие; время прохождения; дата окончания. Не хранится,
// а считается из прогресса путешествия — как очки и сакура (gamification.ts).

export type CheckpointResult = {
  id: string;
  // Понятие — название чекпоинта
  concept: string;
  correct: number;
  total: number;
  points: number;
  status: TopicStatus;
};

export type JourneyResult = {
  finished: boolean;
  // Закончено чекпоинтов (все упражнения с итогом) из скольких
  checkpointsDone: number;
  checkpointsTotal: number;
  points: number;
  // Время прохождения, секунд: время, потраченное на упражнения чекпоинтов по их таймерам.
  // Конспекты и переходы не в счёт, как и в самом путешествии; пауза, пока ИИ оценивает, — тоже
  seconds: number;
  finishedAt: number | null;
  checkpoints: CheckpointResult[];
};

// Итог упражнения для правила «усвоено / стоит повторить». Калибровка, где все ответы
// верны, — верна, даже если в части вы сомневались (как «Верно N из M» в итогах).
// Ответ, который ИИ не смог оценить, — не ошибка: такого упражнения в теме как будто нет
function outcomeVerdict(outcome: ExerciseOutcome): Verdict | "unrated" {
  if (outcome.unrated && outcome.skipped) return "unrated";
  if (isFullyCorrect(outcome)) return "correct";
  return outcome.verdict === "partial" ? "partial" : "incorrect";
}

export function journeyResult(progress: JourneyProgress): JourneyResult {
  const gamification = computeGamification(progress);
  const { checkpoints } = progress.journey;
  let seconds = 0;
  const results = checkpoints.map((checkpoint, index): CheckpointResult => {
    const run = progress.runs[checkpoint.id];
    // Остаток записан, когда чекпоинт закончен; за паузы оценки момент окончания сдвигался,
    // поэтому «норма минус остаток» — время без пауз
    if (run?.timeLeftSec !== undefined) seconds += Math.max(0, checkpointSeconds(checkpoint) - run.timeLeftSec);
    const verdicts = checkpoint.exercises.map(({ exercise }) => {
      const outcome = progress.outcomes[exercise.id];
      return outcome ? outcomeVerdict(outcome) : null;
    });
    return {
      id: checkpoint.id,
      concept: checkpoint.title,
      correct: verdicts.filter((verdict) => verdict === "correct").length,
      total: checkpoint.exercises.length,
      points: gamification.checkpoints[index]?.total ?? 0,
      status: topicStatus(verdicts.filter((verdict): verdict is Verdict | null => verdict !== "unrated")),
    };
  });
  return {
    finished: progress.stage.kind === "finished",
    checkpointsDone: checkpoints.filter((_, index) => isCheckpointDone(progress, index)).length,
    checkpointsTotal: checkpoints.length,
    points: gamification.total,
    seconds,
    finishedAt: progress.finishedAt ?? null,
    checkpoints: results,
  };
}
