"use client";

import { useSyncExternalStore } from "react";

// Выключатель «Учитывать прогресс в ответах ИИ» — на странице прогресса, в «Ваших данных».
// По умолчанию включён. Выключенный: поиск не отправляет сводку и сохранённые путешествия
// (components/search/context.ts), путешествие по материалам портала — сводку
// (components/journey/api.ts), а в форме нет кнопок тем «Стоит повторить:»; блок «Разбор
// ошибок» говорит, что учёт выключен. Сам прогресс записывается и показывается, как прежде.
// Свой ключ localStorage, записан только выключенный: это настройка, а не прогресс,
// поэтому «Удалить весь прогресс» её не трогает.

const STORAGE_KEY = "progress-for-ai";
const OFF = "off";
// Событие для этой же вкладки: выключатель и блоки, которые от него зависят, перерисовываются
const CHANGE_EVENT = "progress-for-ai-change";

// Включён ли учёт. Хранилище недоступно — включён, как по умолчанию
export function isProgressForAi(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== OFF;
  } catch {
    return true;
  }
}

export function setProgressForAi(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, OFF);
  } catch {
    // Хранилище недоступно — выбор не запомнится
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

// На сервере и при гидратации — включён: так по умолчанию, а разметка сервера и браузера совпадает
export function useProgressForAi(): boolean {
  return useSyncExternalStore(subscribe, isProgressForAi, () => true);
}
