// Типы поиска по материалам. Файл без server-only: типы ответа маршрута
// (SearchResponse и SearchSource) нужны и панели поиска в браузере.

export type ChunkKind = "section" | "exercise";

// Фрагмент индекса до эмбеддинга. Живёт только на сервере: у упражнения в text —
// объяснение верного ответа, в браузер оно не уходит
export type ChunkSource = {
  // section:<slug>#<id раздела> или exercise:<id упражнения>
  id: string;
  kind: ChunkKind;
  articleSlug: string;
  // id раздела статьи (якорь); "" — вступление до первого раздела
  sectionId: string;
  // [название статьи, раздел]; у вступления — только название статьи
  path: string[];
  // Текст для поиска: путь, затем текст раздела или вопрос и объяснение упражнения
  text: string;
  // Только у упражнений
  exerciseId?: string;
  question?: string;
  // Хеш текста: по нему скрипт индексации узнаёт, что фрагмент изменился
  hash: string;
};

export type IndexedChunk = ChunkSource & {
  // Вектор эмбеддинга (нормирован к длине 1); null — индекс собран без модели эмбеддингов
  embedding: number[] | null;
};

// Файл индекса lib/search/search-index.json
export type SearchIndexFile = {
  // Модель эмбеддингов, которой посчитаны векторы; null — векторов нет
  model: string | null;
  dimensions: number | null;
  chunks: IndexedChunk[];
};

// Сохранённое путешествие, как его присылает браузер вместе с вопросом: только то,
// что нужно поиску, — названия, понятия и конспекты чекпоинтов (без упражнений, ответов и дат)
export type JourneySearchInput = {
  id: string;
  title: string;
  checkpoints: { id: string; title: string; concept: string; summary: string }[];
  // Векторы чекпоинтов по порядку, если сервер уже посчитал их (см. lib/search/journeys.ts)
  vectors?: JourneyVectors;
};

// Векторы фрагментов путешествия: модель эмбеддингов и по вектору на чекпоинт (base64).
// Посчитаны другой моделью — сервер считает заново
export type JourneyVectors = { model: string; data: string[] };

// Источник в ответе маршрута — то, что видит человек. У упражнения — вопрос,
// а объяснение верного ответа — только если человек на него уже отвечал
export type SearchSource = {
  // Номер источника в ответе модели: [1], [2]…
  number: number;
  kind: ChunkKind | "journey";
  // Путь «Статья › Раздел» или «название путешествия» › понятие (ярлык «Путешествие» — по kind)
  path: string[];
  // Ссылка на раздел (/articles/<slug>#<id>) или на путешествие (/journey?id=<id>)
  href: string;
  // Начало текста раздела или конспекта, вопрос упражнения
  snippet: string;
  // Упражнение: последний ответ человека — ярлык «Вы ответили верно» или «Стоит повторить»;
  // нет поля — не отвечал
  result?: "correct" | "review";
  // Упражнение, на которое человек уже отвечал: объяснение верного ответа
  explanation?: string;
  // Путешествие: его id — дату создания панель берёт из сохранённого путешествия,
  // на сервер она не уходит
  journeyId?: string;
};

export type SearchMode = "semantic-and-words" | "words";

export type SearchAnswer = {
  // Текст ответа с номерами источников [N] (только из переданных модели)
  text: string;
};

// Ответ POST /api/search
export type SearchResponse = {
  question: string;
  mode: SearchMode;
  sources: SearchSource[];
  // null — ответа ИИ нет: модель не настроена, недоступна, ответила не по схеме
  // или ничего не нашлось
  answer: SearchAnswer | null;
  // В найденных фрагментах ответа нет — модель так и сказала. Панель тогда называет
  // фрагменты не «Источники», а «Что нашёл поиск»: ответ на них не опирается
  notInMaterials: boolean;
  // Векторы путешествий, которые пришли без них (или посчитаны другой моделью): браузер
  // сохраняет их вместе с путешествием и больше их не пересчитывают
  journeyVectors?: ({ journeyId: string } & JourneyVectors)[];
};
