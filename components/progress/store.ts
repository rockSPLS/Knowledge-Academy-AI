import {
  isChoiceType,
  MAX_ANSWER_RECORDS,
  MAX_TEST_ATTEMPTS,
  type AnswerRecord,
  type ProgressData,
  type TestAttempt,
} from "@/lib/progress/types";

// Хранение прогресса в localStorage браузера: ответы на упражнения статей и теста,
// попытки теста, время на статьях. Каждая запись читает хранилище заново и сразу
// пишет обратно — так ответы из статьи и время, которое считается рядом, не затирают
// друг друга. Испорченные записи при чтении отбрасываются по одной: страница не ломается.
// Две вкладки по-прежнему могут перезаписать друг друга (синхронизации вкладок нет).

const STORAGE_KEY = "learning-progress";
// Событие для этой же вкладки: страница прогресса перерисовывается, когда что-то записано
const CHANGE_EVENT = "learning-progress-change";

const VERDICTS = new Set(["correct", "partial", "incorrect"]);

export function emptyProgress(): ProgressData {
  return { version: 1, answers: [], tests: [], articleSeconds: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function isAnswerRecord(value: unknown): value is AnswerRecord {
  return (
    isRecord(value) &&
    typeof value.exerciseId === "string" &&
    (value.place === "article" || value.place === "test") &&
    VERDICTS.has(value.verdict as string) &&
    isTime(value.score) &&
    isTime(value.at) &&
    typeof value.topic === "string" &&
    (value.answer === undefined || isRecord(value.answer))
  );
}

function isTestAttempt(value: unknown): value is TestAttempt {
  return (
    isRecord(value) && isTime(value.at) && isTime(value.score) && isTime(value.total) && value.total > 0 && isTime(value.seconds)
  );
}

// Прочитанный прогресс: неверные записи отброшены; хранилище недоступно или записи нет — пустой
export function loadProgressData(): ProgressData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseProgress(raw) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

function parseProgress(raw: string): ProgressData {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return emptyProgress();
  }
  // Другая версия формата — читать её этот код не умеет
  if (!isRecord(value) || value.version !== 1) return emptyProgress();
  const articleSeconds: Record<string, number> = {};
  if (isRecord(value.articleSeconds)) {
    for (const [slug, seconds] of Object.entries(value.articleSeconds)) {
      if (isTime(seconds)) articleSeconds[slug] = seconds;
    }
  }
  return {
    version: 1,
    answers: Array.isArray(value.answers) ? value.answers.filter(isAnswerRecord) : [],
    tests: Array.isArray(value.tests) ? value.tests.filter(isTestAttempt) : [],
    articleSeconds,
  };
}

function update(change: (data: ProgressData) => ProgressData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(change(loadProgressData())));
    notify();
  } catch {
    // localStorage недоступен или переполнен — запись просто не сохранится
  }
}

function notify() {
  cachedRaw = undefined;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// Проверенный ответ, время — момент записи. Ответ на упражнение без выбора (свой текст) не хранится
export function recordAnswer(record: Omit<AnswerRecord, "at">, exerciseType: string): void {
  const { answer, ...rest } = record;
  const stored: AnswerRecord = {
    ...rest,
    at: Date.now(),
    ...(answer !== undefined && isChoiceType(exerciseType) && { answer }),
  };
  update((data) => ({ ...data, answers: [...data.answers, stored].slice(-MAX_ANSWER_RECORDS) }));
}

export function recordTestAttempt(attempt: TestAttempt): void {
  update((data) => ({ ...data, tests: [...data.tests, attempt].slice(-MAX_TEST_ATTEMPTS) }));
}

export function addArticleSeconds(slug: string, seconds: number): void {
  if (!(seconds > 0)) return;
  update((data) => ({
    ...data,
    articleSeconds: { ...data.articleSeconds, [slug]: (data.articleSeconds[slug] ?? 0) + seconds },
  }));
}

export function clearProgressData(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    notify();
  } catch {
    // Хранилище недоступно — удалять нечего
  }
}

// ---------- Подписка для useSyncExternalStore ----------
// Снимок — тот же объект, пока строка в хранилище не изменилась

let cachedRaw: string | null | undefined;
let cachedData: ProgressData = emptyProgress();

export function subscribeProgress(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      cachedRaw = undefined;
      listener();
    }
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function progressSnapshot(): ProgressData {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Хранилище недоступно — прогресс пустой
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedData = raw ? parseProgress(raw) : emptyProgress();
  }
  return cachedData;
}

const SERVER_SNAPSHOT = emptyProgress();
export function serverProgressSnapshot(): ProgressData {
  return SERVER_SNAPSHOT;
}
