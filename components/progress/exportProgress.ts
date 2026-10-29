import { journeyResult, outcomeVerdict } from "@/components/journey/results";
import type { SavedJourney } from "@/components/journey/saved";
import { describeChoice, describeJourneyExercise } from "@/components/review/journeyExercises";
import type { PublicExercise } from "@/lib/exercises/types";
import type { ArticleTopics, ProgressData } from "@/lib/progress/types";

// «Скачать прогресс» — файл JSON progress-ГГГГ-ММ-ДД.json: всё, что портал записал о человеке
// в этом браузере. Ответы на упражнения статей и теста, попытки теста, время на статьях
// и сохранённые путешествия — название, даты, итоги и по чекпоинтам понятие, итог и упражнения
// с ответами человека. Зашифрованной части путешествия и векторов для поиска в файле нет:
// человеку они ничего не скажут. Имена полей — английские и говорящие, тексты — по-русски:
// вопрос, тема «Статья › Раздел», ответ с выбором словами вариантов — так же, как его видит
// разбор ошибок (components/review/journeyExercises.ts). Даты — ISO 8601, время — в секундах.
// Загрузить файл обратно нельзя: перенос прогресса на другое устройство не входит.

const isoDate = (ms: number) => new Date(ms).toISOString();

// exercises — публичная часть упражнений банка (вопрос и варианты, без ответов): по ней ответ
// с выбором записывается словами. Упражнения уже нет в банке — только id и ответ как в хранилище
export function buildProgressExport(
  data: ProgressData,
  journeys: SavedJourney[],
  articles: ArticleTopics,
  exercises: Record<string, PublicExercise>,
) {
  const topics = new Map(articles.flatMap((article) => article.topics).map((topic) => [topic.key, topic.path.join(" › ")]));
  const titles = new Map(articles.map((article) => [article.slug, article.title]));

  return {
    site: "Prompt Engineering Academy",
    exportedAt: isoDate(Date.now()),
    answers: data.answers.map((record) => {
      const exercise = exercises[record.exerciseId];
      const words = exercise && record.answer ? describeChoice(exercise, record.answer).answer : undefined;
      return {
        date: isoDate(record.at),
        place: record.place,
        exercise: record.exerciseId,
        ...(exercise && { question: exercise.question }),
        topic: topics.get(record.topic) ?? record.topic,
        result: record.verdict,
        score: record.score,
        ...(record.answer && { answer: words ?? record.answer }),
      };
    }),
    testAttempts: data.tests.map((attempt) => ({
      date: isoDate(attempt.at),
      score: attempt.score,
      total: attempt.total,
      seconds: attempt.seconds,
    })),
    articleTime: Object.entries(data.articleSeconds).map(([slug, seconds]) => ({
      article: titles.get(slug) ?? slug,
      seconds: Math.round(seconds),
    })),
    journeys: journeys.map((saved) => {
      const { progress } = saved;
      const result = journeyResult(progress);
      return {
        title: progress.journey.title,
        fromPortalMaterials: progress.journey.origin === "portal",
        createdAt: isoDate(saved.createdAt),
        finishedAt: result.finishedAt === null ? null : isoDate(result.finishedAt),
        finished: result.finished,
        seconds: result.seconds,
        points: result.points,
        checkpoints: progress.journey.checkpoints.map((checkpoint, i) => ({
          concept: checkpoint.title,
          status: result.checkpoints[i].status,
          correct: result.checkpoints[i].correct,
          total: result.checkpoints[i].total,
          points: result.checkpoints[i].points,
          // Только упражнения с итогом: на остальные ответа ещё не было
          exercises: checkpoint.exercises.flatMap(({ exercise }) => {
            const outcome = progress.outcomes[exercise.id];
            if (!outcome) return [];
            const { text, errors, ...described } = describeJourneyExercise(exercise, outcome);
            return [
              {
                result: outcomeVerdict(outcome),
                score: outcome.score,
                ...described,
                // Свободный ответ — своими словами, остальные — словами вариантов
                ...(text !== undefined && { answer: text }),
                ...(errors && { mistakes: errors }),
              },
            ];
          }),
        })),
      };
    }),
  };
}

// Имя файла — по дате скачивания в часовом поясе человека
export function progressFileName(now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `progress-${day}.json`;
}

export function downloadProgress(file: ReturnType<typeof buildProgressExport>): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = progressFileName();
  document.body.append(link);
  link.click();
  link.remove();
  // Скачивание уже началось — адрес больше не нужен
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
