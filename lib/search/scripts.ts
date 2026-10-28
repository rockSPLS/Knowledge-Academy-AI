// Проверка письма в ответе модели — для ответа поиска (search.ts) и разбора ошибок (lib/review/review.ts).
// Чужое письмо — всё, кроме кириллицы, латиницы и общих знаков (цифры, пунктуация).
// Модель на проверке дважды вставила в разбор слово на китайском (DEV_NOTES.md, итерация 3) —
// это сбой. Но письмо из самих данных законно: путешествие о японском языке или с греческими
// буквами в формулах. Поэтому сбой — только письмо, которого в данных нет

const FOREIGN = /[^\p{Script=Cyrillic}\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/gu;
const SCRIPTS = [
  { name: "Han", pattern: /\p{Script=Han}/u },
  { name: "Hiragana", pattern: /\p{Script=Hiragana}/u },
  { name: "Katakana", pattern: /\p{Script=Katakana}/u },
  { name: "Hangul", pattern: /\p{Script=Hangul}/u },
  { name: "Greek", pattern: /\p{Script=Greek}/u },
  { name: "Arabic", pattern: /\p{Script=Arabic}/u },
  { name: "Hebrew", pattern: /\p{Script=Hebrew}/u },
  { name: "Devanagari", pattern: /\p{Script=Devanagari}/u },
  { name: "Thai", pattern: /\p{Script=Thai}/u },
];

// Какие чужие письма есть в тексте; письмо не из списка — "other"
export function foreignScripts(text: string): Set<string> {
  const found = new Set<string>();
  for (const char of text.match(FOREIGN) ?? []) {
    found.add(SCRIPTS.find((script) => script.pattern.test(char))?.name ?? "other");
  }
  return found;
}

// В тексте нет чужого письма, которого нет среди разрешённых (из данных)
export const fitsScripts = (text: string, allowed: Set<string>) =>
  [...foreignScripts(text)].every((name) => allowed.has(name));
