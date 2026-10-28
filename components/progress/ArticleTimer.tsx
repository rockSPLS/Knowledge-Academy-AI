"use client";

import { addArticleSeconds } from "./store";
import { useActiveTime } from "./useActiveTime";

// Время на статье: пока вкладка открыта и видна, с паузой после 2 минут без действий
// (useActiveTime.ts). Сумма по статье — в прогрессе (store.ts). Ничего не рисует
export function ArticleTimer({ slug }: { slug: string }) {
  useActiveTime(true, (seconds) => addArticleSeconds(slug, seconds));
  return null;
}
