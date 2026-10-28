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

// Источник в ответе маршрута — то, что видит человек. У упражнения только вопрос:
// объяснения верного ответа здесь нет
export type SearchSource = {
  // Номер источника в ответе модели: [1], [2]…
  number: number;
  kind: ChunkKind;
  // Путь «Статья › Раздел»
  path: string[];
  // Ссылка на раздел: /articles/<slug>#<id>
  href: string;
  // Начало текста раздела или вопрос упражнения
  snippet: string;
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
};
