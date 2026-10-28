"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  loadSavedJourneys,
  savedJourneysSnapshot,
  serverSavedJourneysSnapshot,
  subscribeSavedJourneys,
  type SavedJourney,
} from "@/components/journey/saved";
import type { ProgressData } from "@/lib/progress/types";
import { progressSnapshot, serverProgressSnapshot, subscribeProgress } from "./store";

// Прогресс и сохранённые путешествия для отрисовки. Пока страница не открылась
// в браузере (на сервере и при гидратации), значения — undefined: localStorage там нет,
// и показывать «Пока пусто» до чтения хранилища было бы неправдой.

const noSubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

export function useProgressData(): ProgressData | undefined {
  const hydrated = useHydrated();
  const data = useSyncExternalStore(subscribeProgress, progressSnapshot, serverProgressSnapshot);
  return hydrated ? data : undefined;
}

export function useSavedJourneys(): SavedJourney[] | undefined {
  const hydrated = useHydrated();
  const journeys = useSyncExternalStore(subscribeSavedJourneys, savedJourneysSnapshot, serverSavedJourneysSnapshot);
  // Перенос путешествия из прежнего хранилища (пишет в localStorage — поэтому в эффекте)
  useEffect(() => {
    loadSavedJourneys();
  }, []);
  return hydrated ? journeys : undefined;
}
