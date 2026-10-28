import type {
  CostedSelectAnswer,
  ExerciseReviewDetails,
  MatchPairsAnswer,
  MultipleChoiceAnswer,
  OrderStepsAnswer,
  TrueFalseAnswer,
  Verdict,
} from "@/lib/exercises/types";

// Прогресс человека: ответы на упражнения статей и итогового теста, попытки теста
// и время на статьях. Хранится только в браузере (components/progress/store.ts);
// сохранённые путешествия — отдельно (components/journey/saved.ts).
// Файл без server-only: типы и пределы нужны и браузеру, и серверу поиска.

// Типы упражнений с выбором: у них в прогресс записывается и сам ответ — какой вариант
// выбран, в каком порядке стоят шаги, какие пары соединены. Ответы своими словами
// (пропуски, «Улучшите промпт») не хранятся: это текст человека
export const CHOICE_TYPES = ["multiple-choice", "true-false", "match-pairs", "order-steps", "costed-select"] as const;
export type ChoiceType = (typeof CHOICE_TYPES)[number];
export type ChoiceAnswer =
  | MultipleChoiceAnswer
  | TrueFalseAnswer
  | MatchPairsAnswer
  | OrderStepsAnswer
  | CostedSelectAnswer;

export function isChoiceType(type: ExerciseReviewDetails["type"] | string): type is ChoiceType {
  return (CHOICE_TYPES as readonly string[]).includes(type);
}

// Тема статьи — раздел, к которому относится упражнение (lib/progress/topics.ts)
export type ArticleTopic = {
  // <slug>#<якорь раздела>
  key: string;
  articleSlug: string;
  sectionId: string;
  // [название статьи, раздел]
  path: string[];
  exerciseIds: string[];
};

// Темы по статьям, в порядке курса — для страницы прогресса
export type ArticleTopics = {
  slug: string;
  title: string;
  topics: ArticleTopic[];
}[];

// Где дан ответ
export type AnswerPlace = "article" | "test";

// Проверенный ответ на упражнение банка
export type AnswerRecord = {
  exerciseId: string;
  place: AnswerPlace;
  verdict: Verdict;
  score: number;
  // Когда проверен, мс с 1970 г.
  at: number;
  // Тема — раздел статьи, к которому относится упражнение: <slug>#<якорь раздела>
  topic: string;
  // Только у упражнений с выбором
  answer?: ChoiceAnswer;
};

// Завершённая попытка итогового теста
export type TestAttempt = {
  at: number;
  // Сумма баллов (частично верные дают долю) и число вопросов
  score: number;
  total: number;
  // Время прохождения, секунд: от первого ответа до «Завершить тест», с паузой без действий
  seconds: number;
};

export type ProgressData = {
  version: 1;
  // От старых к новым; старые уходят первыми, когда записей больше MAX_ANSWER_RECORDS
  answers: AnswerRecord[];
  tests: TestAttempt[];
  // Время на статьях, секунд: slug → сумма
  articleSeconds: Record<string, number>;
};

// Сколько ответов хранится: на все 12 упражнений банка — десятки попыток каждое.
// Старые уходят первыми; итог темы считается по последнему ответу, его это не задевает
export const MAX_ANSWER_RECORDS = 500;
// Сколько попыток теста хранится (лучший результат — среди них)
export const MAX_TEST_ATTEMPTS = 100;
// Сколько путешествий хранится (components/journey/saved.ts); столько же принимает поиск
export const MAX_SAVED_JOURNEYS = 20;
// Потолок длины названий, понятий и конспектов путешествия: его проверяет генерация
// (lib/journey/build.ts), по нему браузер обрезает, а сервер поиска проверяет эти строки
export const MAX_JOURNEY_TEXT = 1500;

// ---------- Сводка прогресса для поиска ----------
// Браузер собирает её из прогресса и путешествий (summary.ts) и отправляет вместе
// с вопросом. Сводка не растёт вместе с историей: по упражнению — последний ответ
// (упражнений в банке 12), плюс несколько последних ошибок и понятий. Времени и дат в ней нет.

export const MAX_SUMMARY_EXERCISES = 50;
export const MAX_SUMMARY_MISTAKES = 5;
export const MAX_SUMMARY_JOURNEY_CONCEPTS = 10;
export const MAX_SUMMARY_MASTERED_CONCEPTS = 10;
// Потолок длины названия и понятия в сводке: блок «Прогресс» не должен перерасти фрагменты,
// даже если сводку подделали. Длиннее — обрезается в браузере (summary.ts)
export const MAX_SUMMARY_TEXT = 300;

export type SummaryAnswer = { id: string; verdict: Verdict; answer?: ChoiceAnswer };

export type ProgressSummary = {
  // Последний итог по каждому упражнению банка — без самого ответа: ответ нужен только в ошибках
  exercises: { id: string; verdict: Verdict }[];
  // Последние ошибки (неверно или частично), от новых к старым, по одной на упражнение
  mistakes: SummaryAnswer[];
  // Понятия путешествий, которые стоит повторить, от новых путешествий к старым
  journeyConcepts: { journey: string; concept: string }[];
  // Понятия путешествий, которые усвоены, — тоже от новых к старым: без них на «что я знаю
  // про …» после путешествия без ошибок модели было бы нечего сказать
  masteredConcepts: { journey: string; concept: string }[];
};
