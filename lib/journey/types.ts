import type { Exercise, PublicExercise } from "@/lib/exercises/types";

// Путешествие по знаниям: несколько чекпоинтов по одному понятию, в каждом —
// конспект и 2–3 упражнения. Полная версия (с правильными ответами и подсказками)
// хранится только в зашифрованном виде (см. seal.ts); браузер получает публичную.

// Сложность упражнения: 1 — понять и узнать, 2 — объяснить и различить,
// 3 — применить в новой ситуации
export type Difficulty = 1 | 2 | 3;

export type JourneyExercise = {
  exercise: Exercise;
  difficulty: Difficulty;
  // Подсказка для застрявшего: наводит на мысль, но не называет ответ. Приватна
  hint: string;
};

export type Checkpoint = {
  id: string;
  title: string;
  // Одно предложение: что именно нужно понять
  concept: string;
  // Короткий конспект понятия: с ним путешествие можно пройти и без исходного материала
  summary: string;
  // id более ранних чекпоинтов, на которые опирается этот
  dependsOn: string[];
  exercises: JourneyExercise[];
};

// Утверждение из присланного текста, которое расходится с общепринятыми сведениями
export type SourceDoubt = {
  claim: string;
  note: string;
};

export type Journey = {
  // Версия формата: зашифрованное путешествие старого формата не откроется
  version: 1;
  title: string;
  createdAt: string;
  doubts: SourceDoubt[];
  checkpoints: Checkpoint[];
  // Только при разработке: путешествие собрано из сохранённых ответов модели
  // (lib/journey/fixtures/) — свободные ответы тогда оцениваются по ним же, без запросов
  fixture?: string;
};

// ---------- Публичная часть — то, что видит браузер ----------

export type PublicJourneyExercise = {
  exercise: PublicExercise;
  difficulty: Difficulty;
};

export type PublicCheckpoint = Omit<Checkpoint, "exercises"> & {
  exercises: PublicJourneyExercise[];
};

export type PublicJourney = {
  title: string;
  doubts: SourceDoubt[];
  checkpoints: PublicCheckpoint[];
};
