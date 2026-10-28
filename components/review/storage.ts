import type { ProgressSummary } from "@/lib/progress/types";
import type { Review } from "@/lib/review/types";

// Последний разбор ошибок — в sessionStorage вкладки, вместе со сводкой прогресса,
// по которой он составлен. Перезагрузка и возврат на страницу не тратят новый запрос,
// а если сводка с тех пор изменилась (новые ответы), рядом с разбором — «Разобрать заново».
// Разбор один на вкладку: его видят и страница прогресса, и итоги теста. Неудачный разбор
// не хранится; удаление всего прогресса удаляет и разбор (ProgressApp.tsx).
// Рядом — отметка «блок свёрнут»: свёрнутый блок остаётся свёрнутым до закрытия вкладки,
// а новый разбор и удаление прогресса его разворачивают.

const STORAGE_KEY = "progress-review";
const COLLAPSED_KEY = "progress-review-collapsed";
// Событие для этой же вкладки: блоки перерисовываются, когда разбор записан или удалён
const CHANGE_EVENT = "progress-review-change";

// total — сколько тем стоило повторить, когда просили разбор: если пунктов меньше,
// блок пишет «В разбор вошли N из M тем»
export type SavedReview = { summary: ProgressSummary; review: Review; total: number };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

// Запись от этой версии блока; другой формат или испорченная — как будто разбора нет
function isSavedReview(value: unknown): value is SavedReview {
  if (!isRecord(value) || !isRecord(value.summary) || !isRecord(value.review)) return false;
  const { summary, review } = value;
  return (
    typeof value.total === "number" &&
    ["exercises", "mistakes", "journeyConcepts", "masteredConcepts"].every((key) => Array.isArray(summary[key])) &&
    isString(review.summary) &&
    Array.isArray(review.items) &&
    review.items.every(
      (item) =>
        isRecord(item) &&
        isString(item.topic) &&
        isString(item.mistake) &&
        isString(item.review) &&
        Array.isArray(item.sources) &&
        item.sources.every(
          (source) => isRecord(source) && isString(source.kind) && isString(source.href) && Array.isArray(source.path),
        ),
    )
  );
}

// Свёрнут ли блок. Если хранилище недоступно, отметка живёт в памяти страницы:
// блок всё равно сворачивается, только после перезагрузки снова развёрнут
let memoryCollapsed = false;

export function saveReview(saved: SavedReview): void {
  memoryCollapsed = false;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    // Сразу после разбора блок развёрнут
    sessionStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Не сохранилось — после перезагрузки разбора просто не будет
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearSavedReview(): void {
  memoryCollapsed = false;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Хранилище недоступно — удалять нечего
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function saveCollapsed(collapsed: boolean): void {
  memoryCollapsed = collapsed;
  try {
    if (collapsed) sessionStorage.setItem(COLLAPSED_KEY, "1");
    else sessionStorage.removeItem(COLLAPSED_KEY);
  } catch {
    // Остаётся отметка в памяти
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function collapsedSnapshot(): boolean {
  try {
    return sessionStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return memoryCollapsed;
  }
}

export function serverCollapsedSnapshot(): boolean {
  return false;
}

// Сводка та же — разбор составлен по текущим ответам
export function isSameSummary(a: ProgressSummary, b: ProgressSummary): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------- Подписка для useSyncExternalStore ----------
// Снимок — тот же объект, пока строка в хранилище не изменилась

let cachedRaw: string | null | undefined;
let cachedReview: SavedReview | null = null;

export function subscribeReview(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export function reviewSnapshot(): SavedReview | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Хранилище недоступно — разбора нет
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const value: unknown = raw ? JSON.parse(raw) : null;
      cachedReview = isSavedReview(value) ? value : null;
    } catch {
      cachedReview = null;
    }
  }
  return cachedReview;
}

export function serverReviewSnapshot(): SavedReview | null {
  return null;
}
