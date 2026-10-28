import "server-only";
import { getExercise } from "@/lib/exercises/bank";
import type { Verdict } from "@/lib/exercises/types";
import { topicStatus } from "@/lib/progress/mastery";
import { getAllTopics } from "@/lib/progress/topics";
import { MAX_SUMMARY_TEXT, type ArticleTopic } from "@/lib/progress/types";
import { describeEmbeddingError, embedTexts, QUERY_INSTRUCTION, readEmbeddingConfig } from "@/lib/search/embeddings";
import { describeAnswer, latestResults } from "@/lib/search/progress";
import { rankSemantic } from "@/lib/search/rank";
import type { ProgressInput } from "@/lib/search/request";
import indexFile from "@/lib/search/search-index.json";
import type { IndexedChunk, JourneySearchInput, SearchIndexFile } from "@/lib/search/types";
import { answerErrors } from "@/lib/search/answers";
import { topicTitle } from "./topicTitles";
import { MAX_REVIEW_EXERCISES_PER_CONCEPT, reviewShares, type ReviewJourneyExercise, type ReviewSource } from "./types";

// Что получает модель для разбора: темы и понятия, которые стоит повторить, и фрагменты
// к каждой теме. Темы считает сервер по сводке прогресса — тем же правилом, что страница
// прогресса (lib/progress/mastery.ts):
// - тема статьи — её раздел и упражнения темы, на которые человек отвечал: вопрос, итог,
//   ответ человека словами вариантов с пометкой, что в нём неверно (lib/search/answers.ts), и объяснение
//   верного ответа — прямо из индекса, без поиска;
// - понятие путешествия — конспект чекпоинта из присланных путешествий, разделы статей,
//   близкие к понятию по смыслу (порог — как в поиске), и упражнения чекпоинта с ошибкой,
//   которые прислал браузер (lib/review/request.ts): вопрос, итог, ответ человека — словами
//   вариантов или своими словами — и оценка ИИ. Эмбеддинги всех понятий — одним
//   запросом к сервису; без модели эмбеддингов или при ошибке сервиса — без разделов.
// Упражнения, на которые человек не отвечал, сюда не попадают: их объяснения не уходят ни модели,
// ни в браузер. Тем — не больше MAX_REVIEW_ITEMS, и если есть оба вида, в разбор идут оба
// (reviewShares). Пределы — константы (types.ts), запрос не растёт вместе с прогрессом.

const index = indexFile as SearchIndexFile;
const sectionChunks = index.chunks.filter((chunk) => chunk.kind === "section");

// Сколько разделов статей искать к одному понятию путешествия
const MAX_SECTIONS_PER_CONCEPT = 2;
// Тайм-аут эмбеддингов понятий: без них разбор всё равно составляется
const EMBEDDING_TIMEOUT_MS = 10_000;

export type ReviewFragment =
  | { kind: "section"; id: string; path: string[]; href: string; text: string }
  | {
      kind: "exercise";
      id: string;
      path: string[];
      href: string;
      question: string;
      verdict: Verdict;
      // Ответ человека словами вариантов; null — упражнение без выбора или ответа нет в сводке
      answer: string | null;
      // Что в ответе неверно (lib/search/answers.ts); null — ответа нет или пометок нет
      errors: string | null;
      explanation: string;
    }
  | {
      kind: "journey";
      // journey-title:<название путешествия>#<понятие> — так фрагмент записан в сохранённых ответах
      id: string;
      path: string[];
      href: string;
      journeyTitle: string;
      concept: string;
      // Конспект чекпоинта; null — путешествие не пришло с запросом
      summary: string | null;
      // Упражнения чекпоинта с ошибкой; пусто — браузер их не прислал (или сохранённый разбор)
      exercises: ReviewJourneyExercise[];
    };

export type ReviewTopic = {
  kind: "article" | "journey";
  // «Статья › Раздел» или понятие, у путешествия — и его название
  title: string;
  // Название пункта в разборе: у темы статьи — понятное без статьи (topicTitles.ts), у понятия — оно само
  name: string;
  // У темы статьи — статья и раздел по отдельности: модель не копирует путь «Статья › Раздел»
  // в название темы; раздела нет — тема о вступлении статьи
  article?: string;
  section?: string;
  journeyTitle?: string;
  // Номера фрагментов темы — с единицы, по списку fragments
  fragments: number[];
};

export type ReviewMaterial = { topics: ReviewTopic[]; fragments: ReviewFragment[] };

const sectionHref = (slug: string, sectionId: string) => `/articles/${slug}${sectionId ? `#${sectionId}` : ""}`;
const journeyHref = (journeyId: string) => `/journey?id=${encodeURIComponent(journeyId)}`;

// Есть ли что разбирать: темы статей и понятия путешествий, которые стоит повторить.
// Понятие без id путешествия не считается: сослаться на него нельзя, и модель получила бы пустой список
export function hasMistakes(progress: ProgressInput): boolean {
  return reviewArticleTopics(progress).length > 0 || progress.journeyConcepts.some((item) => Boolean(item.journeyId));
}

// Темы статей, которые стоит повторить: сначала — в порядке последних ошибок сводки
// (от новых к старым), затем остальные в порядке курса
function reviewArticleTopics(progress: ProgressInput): ArticleTopic[] {
  const results = latestResults(progress);
  const review = getAllTopics().filter(
    (topic) => topicStatus(topic.exerciseIds.map((id) => results.get(id) ?? null)) === "review",
  );
  const order = (topic: ArticleTopic) => {
    const place = progress.mistakes.findIndex((mistake) => topic.exerciseIds.includes(mistake.id));
    return place === -1 ? progress.mistakes.length : place;
  };
  return review
    .map((topic, course) => ({ topic, course }))
    .sort((a, b) => order(a.topic) - order(b.topic) || a.course - b.course)
    .map((item) => item.topic);
}

export async function collectMaterial(
  progress: ProgressInput,
  journeys: JourneySearchInput[],
  journeyExercises: ReviewJourneyExercise[],
  abortSignal?: AbortSignal,
): Promise<ReviewMaterial> {
  const results = latestResults(progress);
  const fragments: ReviewFragment[] = [];
  // Номер фрагмента; тот же фрагмент у двух тем — один номер
  const add = (fragment: ReviewFragment): number => {
    const known = fragments.findIndex((item) => item.id === fragment.id);
    if (known !== -1) return known + 1;
    fragments.push(fragment);
    return fragments.length;
  };
  const topics: ReviewTopic[] = [];
  const articleTopics = reviewArticleTopics(progress);
  // Понятия путешествий: от новых путешествий к старым, без id путешествия — не сослаться
  const reviewConcepts = progress.journeyConcepts.filter(
    (item): item is typeof item & { journeyId: string } => Boolean(item.journeyId),
  );
  const shares = reviewShares(articleTopics.length, reviewConcepts.length);

  for (const topic of articleTopics.slice(0, shares.articles)) {
    const numbers: number[] = [];
    const section = sectionChunks.find(
      (chunk) => chunk.articleSlug === topic.articleSlug && chunk.sectionId === topic.sectionId,
    );
    if (section) numbers.push(add(toSectionFragment(section)));
    for (const id of topic.exerciseIds) {
      const exercise = getExercise(id);
      const verdict = results.get(id);
      if (!exercise || !verdict) continue;
      // Ответ из последних ошибок — только если последний ответ и есть эта ошибка
      const mistake = verdict === "correct" ? undefined : progress.mistakes.find((item) => item.id === id);
      numbers.push(
        add({
          kind: "exercise",
          id: `exercise:${id}`,
          path: topic.path,
          href: sectionHref(topic.articleSlug, topic.sectionId),
          question: exercise.question,
          verdict,
          answer: mistake ? describeAnswer(exercise, mistake.answer) : null,
          errors: mistake ? answerErrors(exercise, mistake.answer) : null,
          explanation: exercise.explanation,
        }),
      );
    }
    topics.push({
      kind: "article",
      title: topic.path.join(" › "),
      name: topicTitle(topic.articleSlug, topic.sectionId, topic.path),
      article: topic.path[0],
      section: topic.path[1],
      fragments: numbers,
    });
  }

  const concepts = reviewConcepts
    .slice(0, shares.concepts)
    .map((item) => {
      const journey = journeys.find((saved) => saved.id === item.journeyId);
      // В сводке понятие обрезано до MAX_SUMMARY_TEXT, а название чекпоинта бывает длиннее
      const checkpoint = journey?.checkpoints.find((saved) => saved.title.slice(0, MAX_SUMMARY_TEXT) === item.concept);
      return { item, checkpoint };
    });
  const sections = await sectionsForConcepts(
    concepts.map(({ item, checkpoint }) => (checkpoint ? `${checkpoint.title}. ${checkpoint.concept}` : item.concept)),
    abortSignal,
  );
  concepts.forEach(({ item, checkpoint }, i) => {
    const numbers = [
      add({
        kind: "journey",
        id: `journey-title:${item.journey}#${item.concept}`,
        path: [`«${item.journey}»`, item.concept],
        href: journeyHref(item.journeyId),
        journeyTitle: item.journey,
        concept: item.concept,
        summary: checkpoint?.summary ?? null,
        exercises: checkpoint
          ? journeyExercises
              .filter((exercise) => exercise.journeyId === item.journeyId && exercise.checkpointId === checkpoint.id)
              .slice(0, MAX_REVIEW_EXERCISES_PER_CONCEPT)
          : [],
      }),
      ...sections[i].map((chunk) => add(toSectionFragment(chunk))),
    ];
    topics.push({ kind: "journey", title: item.concept, name: item.concept, journeyTitle: item.journey, fragments: numbers });
  });

  return { topics, fragments };
}

// Разделы статей, близкие по смыслу к каждому понятию, — одним запросом к сервису эмбеддингов.
// Без модели эмбеддингов, с индексом другой модели или при ошибке сервиса — разделов нет:
// по словам без порога находились бы случайные совпадения
async function sectionsForConcepts(concepts: string[], abortSignal?: AbortSignal): Promise<IndexedChunk[][]> {
  const none = concepts.map(() => []);
  const config = readEmbeddingConfig();
  if (concepts.length === 0 || !config || index.model !== config.model) return none;
  try {
    const queries = await embedTexts(
      config,
      concepts.map((concept) => QUERY_INSTRUCTION + concept),
      { abortSignal, timeoutMs: EMBEDDING_TIMEOUT_MS, maxRetries: 0 },
    );
    return queries.map((query) =>
      rankSemantic(
        sectionChunks.map((chunk) => chunk.embedding),
        query,
      )
        .slice(0, MAX_SECTIONS_PER_CONCEPT)
        .map((item) => sectionChunks[item.index]),
    );
  } catch (error) {
    if (!abortSignal?.aborted) {
      console.error(`[review] эмбеддинги понятий не получены, разбор без разделов к ним: ${describeEmbeddingError(error)}`);
    }
    return none;
  }
}

function toSectionFragment(chunk: IndexedChunk): ReviewFragment {
  const prefix = `${chunk.path.join(" › ")}\n\n`;
  return {
    kind: "section",
    id: chunk.id,
    path: chunk.path,
    href: sectionHref(chunk.articleSlug, chunk.sectionId),
    text: chunk.text.startsWith(prefix) ? chunk.text.slice(prefix.length) : chunk.text,
  };
}

// Весь текст фрагмента, который видит модель, — по нему проверяется письмо в разборе (review.ts)
export function fragmentText(fragment: ReviewFragment): string {
  switch (fragment.kind) {
    case "section":
      return fragment.text;
    case "exercise":
      return [fragment.question, fragment.answer ?? "", fragment.errors ?? "", fragment.explanation].join("\n");
    case "journey":
      return [
        fragment.journeyTitle,
        fragment.concept,
        fragment.summary ?? "",
        ...fragment.exercises.map((exercise) => JSON.stringify(exercise)),
      ].join("\n");
  }
}

// Источник для браузера: путь и ссылка, без текста и объяснений
export function toReviewSource(fragment: ReviewFragment): ReviewSource {
  return { kind: fragment.kind, path: fragment.path, href: fragment.href };
}

// Фрагмент по id из сохранённого ответа (lib/review/fixtures.ts): раздел или упражнение
// из индекса, чекпоинт — среди присланных путешествий по названию путешествия и понятию.
// Для источников нужны только путь и ссылка; undefined — такого фрагмента уже нет
export function fragmentById(id: string, journeys: JourneySearchInput[]): ReviewFragment | undefined {
  const journey = /^journey-title:(.+)#(.+)$/.exec(id);
  if (journey) {
    const saved = journeys.find(
      (item) => item.title === journey[1] && item.checkpoints.some((checkpoint) => checkpoint.title === journey[2]),
    );
    if (!saved) return undefined;
    return {
      kind: "journey",
      id,
      path: [`«${journey[1]}»`, journey[2]],
      href: journeyHref(saved.id),
      journeyTitle: journey[1],
      concept: journey[2],
      summary: null,
      exercises: [],
    };
  }
  const chunk = index.chunks.find((item) => item.id === id);
  if (!chunk) return undefined;
  if (chunk.kind === "section") return toSectionFragment(chunk);
  return {
    kind: "exercise",
    id,
    path: chunk.path,
    href: sectionHref(chunk.articleSlug, chunk.sectionId),
    question: chunk.question ?? "",
    verdict: "incorrect",
    answer: null,
    errors: null,
    explanation: "",
  };
}
