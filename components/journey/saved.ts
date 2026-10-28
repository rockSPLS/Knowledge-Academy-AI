import { MAX_SAVED_JOURNEYS } from "@/lib/progress/types";
import type { JourneyVectors } from "@/lib/search/types";
import { isValidProgress, type JourneyProgress } from "./state";

// Сохранённые путешествия — список в localStorage. Путешествие сохраняется само,
// как только создано, и новое не стирает прежние; их до MAX_SAVED_JOURNEYS. Когда список
// полон, новое не начинается: портал просит удалить старые, а не удаляет сам.
//
// Перенос: до списка путешествие было одно, под ключом journey-progress. При первом
// чтении оно становится первым в списке, а старый ключ удаляется — начатое
// путешествие не теряется.
//
// Вместе с путешествием хранятся векторы его чекпоинтов для поиска: их считает сервер
// при первом поиске после создания (lib/search/journeys.ts) и больше не пересчитывает.

export { MAX_SAVED_JOURNEYS };

const STORAGE_KEY = "saved-journeys";
const LEGACY_KEY = "journey-progress";
const CHANGE_EVENT = "saved-journeys-change";

export type SavedJourney = {
  id: string;
  // Когда создано, мс с 1970 г.
  createdAt: number;
  progress: JourneyProgress;
  vectors?: JourneyVectors;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isVectors = (value: unknown): value is JourneyVectors =>
  isRecord(value) &&
  typeof value.model === "string" &&
  Array.isArray(value.data) &&
  value.data.every((item) => typeof item === "string");

function isSavedJourney(value: unknown): value is SavedJourney {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    isValidProgress(value.progress) &&
    (value.vectors === undefined || isVectors(value.vectors))
  );
}

function read(): SavedJourney[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    // Испорченное путешествие отбрасывается, остальные остаются
    return isRecord(value) && value.version === 1 && Array.isArray(value.journeys)
      ? value.journeys.filter(isSavedJourney)
      : [];
  } catch {
    return [];
  }
}

function write(journeys: SavedJourney[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, journeys }));
    cachedRaw = undefined;
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    // localStorage недоступен или переполнен — изменение не записалось. Начатое путешествие
    // проходится дальше, но не переживёт перезагрузку; новое без записи не откроется
    // (JourneyPage.tsx показывает ошибку): открывается оно по адресу, из хранилища
    return false;
  }
}

// Путешествие под старым ключом — первым в списке; старый ключ удаляется,
// только когда список записан
function migrateLegacy(journeys: SavedJourney[]): SavedJourney[] {
  const raw = localStorage.getItem(LEGACY_KEY);
  if (raw === null) return journeys;
  let progress: unknown = null;
  try {
    progress = JSON.parse(raw);
  } catch {
    // Испорчено — переносить нечего
  }
  if (!isValidProgress(progress)) {
    localStorage.removeItem(LEGACY_KEY);
    return journeys;
  }
  const migrated: SavedJourney = {
    id: newJourneyId(),
    // Когда создано, старое путешествие не знает: дата — окончание, если оно было, иначе — сейчас
    createdAt: progress.finishedAt ?? Date.now(),
    progress,
  };
  const next = [migrated, ...journeys];
  if (write(next)) localStorage.removeItem(LEGACY_KEY);
  return next;
}

// Все путешествия, от новых к старым (перенесённое — первым)
export function loadSavedJourneys(): SavedJourney[] {
  try {
    return migrateLegacy(read());
  } catch {
    return [];
  }
}

export function loadSavedJourney(id: string): SavedJourney | null {
  return loadSavedJourneys().find((journey) => journey.id === id) ?? null;
}

export function newJourneyId(): string {
  return crypto.randomUUID();
}

// Новое путешествие — в начало списка, уже сохранённое — на своё место.
// false — не сохранилось (список полон или хранилище недоступно)
export function saveJourney(journey: SavedJourney): boolean {
  const journeys = loadSavedJourneys();
  const index = journeys.findIndex((item) => item.id === journey.id);
  if (index === -1) {
    if (journeys.length >= MAX_SAVED_JOURNEYS) return false;
    return write([journey, ...journeys]);
  }
  // Векторы, которые поиск записал, пока путешествие было открыто, не теряются
  const vectors = journey.vectors ?? journeys[index].vectors;
  return write(journeys.map((item, i) => (i === index ? { ...journey, ...(vectors && { vectors }) } : item)));
}

export function removeJourney(id: string): void {
  write(loadSavedJourneys().filter((journey) => journey.id !== id));
}

export function clearSavedJourneys(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
    cachedRaw = undefined;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Хранилище недоступно — удалять нечего
  }
}

// Векторы чекпоинтов от поиска
export function setJourneyVectors(updates: ({ journeyId: string } & JourneyVectors)[]): void {
  if (updates.length === 0) return;
  write(
    loadSavedJourneys().map((journey) => {
      const update = updates.find((item) => item.journeyId === journey.id);
      return update ? { ...journey, vectors: { model: update.model, data: update.data } } : journey;
    }),
  );
}

// ---------- Подписка для useSyncExternalStore ----------

let cachedRaw: string | null | undefined;
let cachedJourneys: SavedJourney[] = [];

export function subscribeSavedJourneys(listener: () => void): () => void {
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

export function savedJourneysSnapshot(): SavedJourney[] {
  // Снимок только читает: перенос старого путешествия пишет в хранилище,
  // поэтому он — в эффекте (useSavedJourneys), а не во время отрисовки
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Хранилище недоступно — путешествий нет
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedJourneys = raw ? safeRead() : [];
  }
  return cachedJourneys;
}

function safeRead(): SavedJourney[] {
  try {
    return read();
  } catch {
    return [];
  }
}

const SERVER_SNAPSHOT: SavedJourney[] = [];
export function serverSavedJourneysSnapshot(): SavedJourney[] {
  return SERVER_SNAPSHOT;
}
