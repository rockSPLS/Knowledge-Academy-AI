import type { ReactNode } from "react";

// Якоря разделов статей: id у заголовков «##», чтобы ссылка /articles/<slug>#<id>
// открывала раздел. Одна и та же функция строит id и на странице статьи
// (mdx-components.tsx), и в индексе поиска (lib/search/chunks.ts) — поэтому ссылки
// источников всегда совпадают с заголовками. Файл без server-only: им пользуется страница.

// Русские буквы — латиницей: адрес раздела читается и одинаково выглядит
// в любом браузере и мессенджере (кириллица в адресе превращается в %D0%...)
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "",
  э: "e", ю: "yu", я: "ya",
};

// «Токены: из чего модель „читает“ текст» → tokeny-iz-chego-model-chitaet-tekst
export function headingId(text: string): string {
  const latin = Array.from(text.toLowerCase(), (char) => TRANSLIT[char] ?? char).join("");
  return latin
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Текст заголовка из его содержимого: в MDX заголовок может состоять из нескольких
// частей (например, слово в `коде`), а id строится по всему тексту
export function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}
