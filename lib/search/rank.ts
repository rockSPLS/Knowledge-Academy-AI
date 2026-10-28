import { scoreWords, type WordIndex } from "./words";

// Ранжирование фрагментов: по смыслу (близость эмбеддингов), по словам (BM25)
// и сочетание двух списков по рангам. Чистые функции без сети и файлов —
// ими пользуются и поиск на сайте, и скрипт замера качества.

// Сколько фрагментов отдаётся модели и показывается источниками
export const RESULT_COUNT = 5;

// Сочетание по рангам (Reciprocal Rank Fusion): фрагмент получает 1 / (k + место)
// из каждого списка, где он есть. Числа близости и BM25 несравнимы между собой,
// а места — сравнимы; чем меньше k, тем больше весят первые места. Подобрано замером
// (DEV_NOTES.md, итерация 1): k = 10 и 30 дали одинаковый результат, 60 — хуже
export const FUSION_K = 30;

// Порог близости по смыслу: ниже него фрагмент не считается найденным, даже если
// он ближе остальных (вопрос не о материалах портала). Подобран замером: у вопросов
// по теме лучший фрагмент — от 0,57, у посторонних — не выше 0,40
export const MIN_SIMILARITY = 0.5;

export type Ranked = { index: number; score: number };

const similarity = (vector: number[] | null | undefined, query: number[]) =>
  vector ? vector.reduce((sum, value, i) => sum + value * query[i], 0) : -1;

// Близость вопроса к каждому фрагменту — скалярное произведение нормированных векторов.
// headings — векторы заголовков тех же фрагментов (у кого есть): близость — наибольшая из двух
export function rankSemantic(
  vectors: (number[] | null)[],
  query: number[],
  minSimilarity = MIN_SIMILARITY,
  headings?: (number[] | undefined)[],
): Ranked[] {
  return vectors
    .map((vector, index) => ({
      index,
      score: Math.max(similarity(vector, query), similarity(headings?.[index], query)),
    }))
    .filter((item) => item.score >= minSimilarity)
    .sort((a, b) => b.score - a.score);
}

// Поиск по смыслу по нескольким наборам фрагментов, у каждого свой вектор вопроса:
// у фрагментов путешествий вектор короче, и вопрос сравнивается с ними началом своего
// вектора той же длины. Номера фрагментов сквозные — по порядку наборов
export function rankSemanticParts(
  parts: { vectors: (number[] | null)[]; query: number[]; headings?: (number[] | undefined)[] }[],
  minSimilarity = MIN_SIMILARITY,
): Ranked[] {
  let offset = 0;
  const all: Ranked[] = [];
  for (const part of parts) {
    const start = offset;
    all.push(...rankSemantic(part.vectors, part.query, minSimilarity, part.headings).map((item) => ({ ...item, index: item.index + start })));
    offset += part.vectors.length;
  }
  return all.sort((a, b) => b.score - a.score);
}

export function rankWords(index: WordIndex, question: string): Ranked[] {
  return scoreWords(index, question)
    .map((score, i) => ({ index: i, score }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Сочетание поиска по смыслу (уже с порогом) и по словам. Если по смыслу ничего
// не нашлось, вопрос не о материалах портала: случайные совпадения слов («будет»,
// «приготовить») не показываются
export function combine(semantic: Ranked[], words: Ranked[], k = FUSION_K): Ranked[] {
  return semantic.length === 0 ? [] : fuse([semantic, words], k);
}

export function fuse(lists: Ranked[][], k = FUSION_K): Ranked[] {
  const scores = new Map<number, number>();
  for (const list of lists) {
    list.forEach((item, place) => scores.set(item.index, (scores.get(item.index) ?? 0) + 1 / (k + place + 1)));
  }
  return [...scores]
    .map(([index, score]) => ({ index, score }))
    .sort((a, b) => b.score - a.score);
}
