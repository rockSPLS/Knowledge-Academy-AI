// Типы разбора ошибок. Файл без server-only: ответ маршрута (ReviewResponse) и пределы
// нужны и блоку «Разбор ошибок» в браузере.

// Сколько тем уходит модели и сколько пунктов в разборе — по пункту на тему
export const MAX_REVIEW_ITEMS = 5;
// Если стоит повторить и темы статей, и понятия путешествий, в разбор идут оба вида:
// до 3 тем статей и до 2 понятий; места вида, которого меньше, отдаются другому.
// Браузер присылает путешествия первых MAX_REVIEW_ITEMS понятий сводки — больше в разбор не войдёт
export const REVIEW_ARTICLE_SHARE = 3;
export const REVIEW_CONCEPT_SHARE = MAX_REVIEW_ITEMS - REVIEW_ARTICLE_SHARE;

// Сколько тем статей и понятий войдёт в разбор: до REVIEW_CONCEPT_SHARE понятий и остальное — темам
// статей; вида, которого меньше, — сколько есть, а его места отдаются другому. Считают и сервер
// (lib/review/material.ts), и браузер — чтобы прислать упражнения только тех понятий, что войдут
export function reviewShares(articleCount: number, conceptCount: number): { articles: number; concepts: number } {
  const concepts = Math.min(conceptCount, Math.max(REVIEW_CONCEPT_SHARE, MAX_REVIEW_ITEMS - articleCount));
  return { articles: Math.min(articleCount, MAX_REVIEW_ITEMS - concepts), concepts };
}

// Упражнений одного понятия путешествия в разборе — не больше: в чекпоинте их два (lib/journey/layout.ts)
export const MAX_REVIEW_EXERCISES_PER_CONCEPT = 2;

// Упражнение понятия путешествия с ошибкой — то, что человек уже видел после проверки.
// Собирает браузер из сохранённого путешествия (components/review/journeyExercises.ts),
// сервер проверяет каждую запись отдельно (lib/review/request.ts). Пределы строк — как у полей
// ввода (свободный ответ, ответ калибровки) и текста путешествия (остальное)
export type ReviewJourneyExercise = {
  journeyId: string;
  checkpointId: string;
  question: string;
  verdict: "partial" | "incorrect";
  // Время вышло, а ответа не было
  skipped?: boolean;
  // Упражнение с выбором: ответ словами вариантов и что в нём неверно — по разбору проверки
  answer?: string;
  errors?: string;
  // Свободный ответ своими словами — целиком — и оценка ИИ по пунктам
  text?: string;
  criteria?: { text: string; met: boolean; feedback: string }[];
  // Калибровка: ответ своими словами на каждый вопрос, уверенность и оценка ИИ
  items?: { question: string; answer: string; confident: boolean; correct: boolean; feedback: string; expected: string }[];
  explanation: string;
};

// Источник пункта: путь и ссылка. Ярлык «Упражнение» или «Путешествие» — по виду.
// Текста фрагмента и объяснений нет: что повторить, говорит сам пункт
export type ReviewSource = {
  kind: "section" | "exercise" | "journey";
  // «Статья › Раздел» или «название путешествия» › понятие
  path: string[];
  // /articles/<slug>#<раздел> (и у упражнения — его раздел) или /journey?id=<id>
  href: string;
};

export type ReviewItem = {
  topic: string;
  // О чём пункт: тема статьи или понятие путешествия — по теме, которой сервер дал название пункта.
  // У пункта о теме статьи — ссылка «Путешествие по этой теме». Нет поля — тема не узнана
  // (или разбор сохранён до появления поля)
  kind?: "article" | "journey";
  // В чём ошибка
  mistake: string;
  // Что повторить
  review: string;
  sources: ReviewSource[];
};

export type Review = {
  // Общий вывод, 1–3 предложения
  summary: string;
  items: ReviewItem[];
};

// Почему разбора нет: модель не настроена, недоступна, ответила не по схеме
// или не дала ни одного годного пункта (без источника, с чужим письмом) — тоже invalid-output
export type ReviewFailure = "not-configured" | "unavailable" | "invalid-output";

// Ответ POST /api/review
export type ReviewResponse =
  | { status: "no-progress" }
  | { status: "no-mistakes" }
  | { status: "done"; review: Review }
  | { status: "failed"; reason: ReviewFailure };
