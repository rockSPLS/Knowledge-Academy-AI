import { outcomeVerdict } from "@/components/journey/results";
import type { SavedJourney } from "@/components/journey/saved";
import type { ExerciseOutcome } from "@/components/journey/state";
import type { ExerciseReviewDetails, PublicExercise } from "@/lib/exercises/types";
import { MAX_JOURNEY_TEXT, MAX_SUMMARY_TEXT, type ProgressSummary } from "@/lib/progress/types";
import { MAX_REVIEW_EXERCISES_PER_CONCEPT, reviewShares, type ReviewJourneyExercise } from "@/lib/review/types";

// Упражнения понятий путешествий с ошибкой — для запроса разбора (api.ts). Только у понятий,
// которые войдут в разбор (reviewShares — то же правило, что у сервера), и только то, что человек
// уже видел после проверки: вопрос, итог, ответ (у упражнений с выбором — словами вариантов
// с пометкой, что неверно, по разбору проверки; свободный ответ и калибровка — своими словами,
// целиком), объяснение и оценку ИИ. Всё это лежит в сохранённом путешествии. Ответ своими словами
// не обрезается: его длину уже ограничило поле ввода, и сервер проверяет тот же предел
// (lib/review/request.ts); остальные строки — до MAX_JOURNEY_TEXT, как у текста путешествия.
// Те же описания ответа словами — в файле «Скачать прогресс» (components/progress/exportProgress.ts).

const clip = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_JOURNEY_TEXT) : "");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Ответ словами вариантов и что в нём неверно — по ответу человека и разбору, который он видел.
// Без разбора (ответы в статьях: в прогресс он не записывается) — только ответ словами
export function describeChoice(
  exercise: PublicExercise,
  given: unknown,
  details?: ExerciseReviewDetails,
): { answer?: string; errors?: string } {
  const answer = isRecord(given) ? given : null;
  if (!answer) return {};
  const quote = (text: string) => `«${text}»`;
  const errors: string[] = [];
  switch (exercise.type) {
    case "multiple-choice": {
      const selected = Array.isArray(answer.selected) ? answer.selected : [];
      const marks = details?.type === "multiple-choice" ? details.options : {};
      for (const option of exercise.options) {
        if (marks[option.id]?.status === "wrong") errors.push(`выбран неверный вариант ${quote(option.text)}`);
        if (marks[option.id]?.status === "missed") errors.push(`не выбран верный вариант ${quote(option.text)}`);
      }
      const texts = exercise.options.filter((option) => selected.includes(option.id)).map((option) => quote(option.text));
      return { answer: texts.length > 0 ? `выбрал(а) ${texts.join(", ")}` : undefined, errors: errors.join("; ") };
    }
    case "true-false": {
      const answers = isRecord(answer.answers) ? answer.answers : {};
      const marks = details?.type === "true-false" ? details.statements : {};
      const parts = exercise.statements
        .filter((statement) => typeof answers[statement.id] === "boolean")
        .map((statement) => `${quote(statement.text)} — ${answers[statement.id] ? "верно" : "неверно"}`);
      for (const statement of exercise.statements) {
        const mark = marks[statement.id];
        if (mark && !mark.isCorrect) {
          errors.push(`${quote(statement.text)} оценено как ${mark.isTrue ? "неверное" : "верное"}, а оно ${mark.isTrue ? "верное" : "неверное"}`);
        }
      }
      return { answer: parts.length > 0 ? `оценил(а) утверждения так: ${parts.join("; ")}` : undefined, errors: errors.join("; ") };
    }
    case "fill-blank": {
      const blanks = isRecord(answer.blanks) ? answer.blanks : {};
      const marks = details?.type === "fill-blank" ? details.blanks : {};
      const text = exercise.parts
        .map((part) => (part.type === "text" ? part.value : `[${typeof blanks[part.id] === "string" ? blanks[part.id] : "—"}]`))
        .join("");
      for (const [id, mark] of Object.entries(marks)) {
        if (!mark.isCorrect) errors.push(`в пропуске ${quote(String(blanks[id] ?? "—"))} нужно ${quote(mark.expected)}`);
      }
      return { answer: `заполнил(а) пропуски так: ${text}`, errors: errors.join("; ") };
    }
    case "match-pairs": {
      const matches = isRecord(answer.matches) ? answer.matches : {};
      const marks = details?.type === "match-pairs" ? details.terms : {};
      const definition = (id: unknown) => exercise.definitions.find((item) => item.id === id)?.text ?? "—";
      const parts = exercise.terms.map((term) => `${quote(term.text)} → ${quote(definition(matches[term.id]))}`);
      for (const term of exercise.terms) {
        const mark = marks[term.id];
        if (mark && !mark.isCorrect) errors.push(`к ${quote(term.text)} нужно ${quote(definition(mark.expected))}`);
      }
      return { answer: `соединил(а) пары: ${parts.join("; ")}`, errors: errors.join("; ") };
    }
    case "order-steps": {
      const order = Array.isArray(answer.order) ? answer.order : [];
      const marks = details?.type === "order-steps" ? details.steps : {};
      const steps = order
        .map((id) => exercise.steps.find((step) => step.id === id))
        .filter((step): step is (typeof exercise.steps)[number] => step !== undefined);
      steps.forEach((step, i) => {
        const mark = marks[step.id];
        if (mark && !mark.isCorrect) errors.push(`шаг ${quote(step.text)} стоит ${i + 1}-м, а в верном порядке он ${mark.position}-й`);
      });
      return {
        answer: steps.length > 0 ? `расставил(а) шаги так: ${steps.map((step, i) => `${i + 1}) ${step.text}`).join(" ")}` : undefined,
        errors: errors.join("; "),
      };
    }
    // «★ Задача со звёздочкой» — только в банке упражнений (в путешествиях её нет); формулировка —
    // как у сервера (lib/search/progress.ts)
    case "costed-select": {
      const selected = Array.isArray(answer.selected) ? answer.selected : [];
      const texts = exercise.options.filter((option) => selected.includes(option.id)).map((option) => quote(option.text));
      return { answer: texts.length > 0 ? `взял(а) в промпт: ${texts.join(", ")}` : "ничего не взял(а)" };
    }
    default:
      return {};
  }
}

// Упражнение путешествия — то, что человек видел после проверки, без итога: его считает место вызова
export type DescribedExercise = Omit<ReviewJourneyExercise, "journeyId" | "checkpointId" | "verdict">;

export function describeJourneyExercise(exercise: PublicExercise, outcome: ExerciseOutcome): DescribedExercise {
  const record: DescribedExercise = {
    question: clip(exercise.question),
    explanation: clip(outcome.explanation),
  };
  if (outcome.skipped && outcome.answer === undefined) record.skipped = true;
  const answer = isRecord(outcome.answer) ? outcome.answer : null;
  if (exercise.type === "free-answer" && typeof answer?.text === "string") {
    record.text = answer.text;
    if (outcome.details?.type === "free-answer") {
      record.criteria = outcome.details.criteria.map((criterion) => ({
        text: clip(criterion.text),
        met: criterion.met,
        feedback: clip(criterion.feedback),
      }));
    }
  } else if (exercise.type === "calibration" && isRecord(answer?.answers)) {
    const answers = answer.answers;
    const judged = outcome.details?.type === "calibration" ? outcome.details.items : {};
    record.items = exercise.items.flatMap((item) => {
      const given = answers[item.id];
      const mark = judged[item.id];
      if (!isRecord(given) || typeof given.text !== "string" || !mark) return [];
      return [
        {
          question: clip(item.question),
          answer: given.text,
          confident: Boolean(given.confident),
          correct: mark.correct,
          feedback: clip(mark.feedback),
          expected: clip(mark.expected),
        },
      ];
    });
  } else {
    const { answer: words, errors } = describeChoice(exercise, outcome.answer, outcome.details);
    if (words) record.answer = clip(words);
    if (errors) record.errors = clip(errors);
  }
  return record;
}

function toReviewExercise(
  journeyId: string,
  checkpointId: string,
  exercise: PublicExercise,
  outcome: ExerciseOutcome,
): ReviewJourneyExercise | null {
  const verdict = outcomeVerdict(outcome);
  if (verdict === "correct" || verdict === "unrated") return null;
  return { journeyId, checkpointId, verdict, ...describeJourneyExercise(exercise, outcome) };
}

// articleCount — сколько тем статей стоит повторить (по правилу страницы прогресса)
export function journeyExercisesForReview(
  summary: ProgressSummary,
  journeys: SavedJourney[],
  articleCount: number,
): ReviewJourneyExercise[] {
  const { concepts } = reviewShares(articleCount, summary.journeyConcepts.length);
  return summary.journeyConcepts.slice(0, concepts).flatMap((concept) => {
    const saved = journeys.find((journey) => journey.id === concept.journeyId);
    // В сводке понятие обрезано до MAX_SUMMARY_TEXT — так же ищет чекпоинт и сервер
    const checkpoint = saved?.progress.journey.checkpoints.find(
      (item) => item.title.slice(0, MAX_SUMMARY_TEXT) === concept.concept,
    );
    if (!saved || !checkpoint) return [];
    return checkpoint.exercises
      .flatMap(({ exercise }) => {
        const outcome = saved.progress.outcomes[exercise.id];
        const record = outcome ? toReviewExercise(saved.id, checkpoint.id, exercise, outcome) : null;
        return record ? [record] : [];
      })
      .slice(0, MAX_REVIEW_EXERCISES_PER_CONCEPT);
  });
}
