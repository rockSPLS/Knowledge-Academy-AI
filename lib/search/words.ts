// Поиск по словам: разбор текста на основы слов и оценка BM25.
// Основа слова отбрасывает русские окончания («галлюцинации», «галлюцинацию» → «галлюцинац»),
// поэтому вопрос находит раздел, даже если слова в нём стоят в другой форме.
// Своя короткая реализация вместо библиотеки: фрагментов несколько десятков,
// а нужна только русская морфология без словарей.

// Частые слова, которые ничего не говорят о теме вопроса
const STOP_WORDS = new Set(
  (
    "а без более бы был была были было быть в вам вас ведь во вот все всё всего вы где да даже для до " +
    "его ее её если есть еще ещё же за и из или им их к как ко когда кто ли либо мне может можно мы на над " +
    "надо нам нас не него нее неё нет ни них но ну о об однако он она они оно от по под при про с со так " +
    "также такой там то того тоже только том ту ты у уже чем что чтобы эта эти это этого этой этом этот " +
    "я какой какая какие каких почему зачем сколько нужно стоит"
  ).split(" "),
);

const VOWELS = "аеиоуыэюя";

// Окончания по группам — упрощённый вариант стеммера Snowball для русского языка.
// Краткие причастия (-ен, -ена, -ены) убраны из глагольных окончаний: иначе «токены» → «ток»
const PERFECTIVE_GERUND = /(?:(?<=[ая])(?:в|вши|вшись)|(?:ив|ивши|ившись|ыв|ывши|ывшись))$/;
const REFLEXIVE = /(?:ся|сь)$/;
const ADJECTIVE =
  /(?:ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
const PARTICIPLE = /(?:(?<=[ая])(?:ем|нн|вш|ющ|щ)|(?:ивш|ывш|ующ))$/;
const VERB =
  /(?:(?<=[ая])(?:ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)|(?:ила|ыла|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ило|ыло|ят|ует|уют|ит|ыт|ить|ыть|ишь|ую|ю))$/;
const NOUN =
  /(?:а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
const DERIVATIONAL = /ость?$/;
const SUPERLATIVE = /(?:ейше|ейш)$/;

// Основа слова: часть после первой гласной (RV) очищается от окончаний
export function stem(word: string): string {
  const firstVowel = Array.from(word).findIndex((char) => VOWELS.includes(char));
  if (firstVowel === -1) return word;
  const head = word.slice(0, firstVowel + 1);
  let rv = word.slice(firstVowel + 1);

  if (PERFECTIVE_GERUND.test(rv)) {
    rv = rv.replace(PERFECTIVE_GERUND, "");
  } else {
    rv = rv.replace(REFLEXIVE, "");
    if (ADJECTIVE.test(rv)) {
      rv = rv.replace(ADJECTIVE, "").replace(PARTICIPLE, "");
    } else if (VERB.test(rv)) {
      rv = rv.replace(VERB, "");
    } else {
      rv = rv.replace(NOUN, "");
    }
  }
  rv = rv.replace(/и$/, "");
  // «ость» — суффикс («конфиденциальность» → «конфиденциальн»), а не часть корня,
  // только если слово после него ещё достаточно длинное
  if (DERIVATIONAL.test(rv) && rv.length > 5) rv = rv.replace(DERIVATIONAL, "");
  rv = rv.replace(/нн$/, "н").replace(SUPERLATIVE, "").replace(/ь$/, "");
  return head + rv;
}

// Слова текста (нижний регистр, «ё» → «е») без частых слов, в виде основ.
// Латиница, цифры и короткие слова («ИИ») остаются как есть: термины вроде «LLM», «JSON» ищутся точно
export function terms(text: string): string[] {
  const words = text.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
  return words
    .filter((word) => !STOP_WORDS.has(word) && (word.length > 1 || /\d/.test(word)))
    .map((word) => (/[а-я]/.test(word) && word.length > 3 ? stem(word) : word));
}

// BM25 — классическая оценка совпадения по словам: редкое слово весит больше
// частого, а длинный фрагмент не выигрывает только за счёт длины
const K1 = 1.2;
const B = 0.75;

export type WordIndex = {
  documents: Map<string, number>[];
  lengths: number[];
  averageLength: number;
  // В скольких фрагментах встречается основа
  documentFrequency: Map<string, number>;
};

export function buildWordIndex(texts: string[]): WordIndex {
  return indexOf(texts.map(countTerms));
}

// Индекс с добавленными текстами (фрагментами путешествий из запроса): тексты исходного
// индекса заново не разбираются, пересчитываются только частоты и средняя длина
export function extendWordIndex(base: WordIndex, texts: string[]): WordIndex {
  return indexOf([...base.documents, ...texts.map(countTerms)]);
}

function countTerms(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const term of terms(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
  return counts;
}

function indexOf(documents: Map<string, number>[]): WordIndex {
  const lengths = documents.map((counts) => [...counts.values()].reduce((sum, n) => sum + n, 0));
  const documentFrequency = new Map<string, number>();
  for (const counts of documents) {
    for (const term of counts.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const averageLength = lengths.reduce((sum, n) => sum + n, 0) / Math.max(lengths.length, 1);
  return { documents, lengths, averageLength, documentFrequency };
}

// Оценка каждого фрагмента для запроса; 0 — ни одного общего слова
export function scoreWords(index: WordIndex, query: string): number[] {
  const queryTerms = [...new Set(terms(query))];
  const total = index.documents.length;
  return index.documents.map((counts, i) => {
    let score = 0;
    for (const term of queryTerms) {
      const frequency = counts.get(term);
      if (!frequency) continue;
      const df = index.documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const norm = K1 * (1 - B + (B * index.lengths[i]) / index.averageLength);
      score += (idf * frequency * (K1 + 1)) / (frequency + norm);
    }
    return score;
  });
}
