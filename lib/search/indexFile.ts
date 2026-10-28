import "server-only";
import path from "node:path";
import type { SearchIndexFile } from "./types";

// Где лежит индекс и как он записывается (скрипты индексации и замера)

export const INDEX_PATH = path.join(process.cwd(), "lib", "search", "search-index.json");

// JSON с отступами, но вектор каждого фрагмента — одной строкой: так в диффе видно,
// какие фрагменты изменились, а не тысячи строк с числами. Окончания строк — CRLF, как у всех файлов проекта
export function serializeIndex(index: SearchIndexFile): string {
  const vectors: string[] = [];
  const json = JSON.stringify(
    index,
    (key, value) => {
      if (key === "embedding" && Array.isArray(value)) {
        vectors.push(JSON.stringify(value));
        return `@@vector${vectors.length - 1}@@`;
      }
      return value;
    },
    2,
  );
  return (
    json.replace(/"@@vector(\d+)@@"/g, (_, i: string) => vectors[Number(i)]).replace(/\n/g, "\r\n") + "\r\n"
  );
}
