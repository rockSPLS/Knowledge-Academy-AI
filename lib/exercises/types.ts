// Типы упражнений. У каждого упражнения есть публичная часть (уходит в браузер)
// и приватная (правильный ответ и объяснение — остаются только на сервере).

// ---------- Выбор ответа ----------

export type ChoiceOption = {
  id: string;
  text: string;
};

// Полное упражнение — хранится в банке вопросов на сервере
export type MultipleChoiceExercise = {
  id: string;
  type: "multiple-choice";
  question: string;
  options: ChoiceOption[];
  // Приватно: id правильных вариантов (если их несколько — можно выбрать несколько)
  correct: string[];
  explanation: string;
};

// Публичная часть — то, что видит браузер
export type PublicMultipleChoice = {
  id: string;
  type: "multiple-choice";
  question: string;
  options: ChoiceOption[];
  // Подсказка интерфейсу: можно ли выбрать несколько вариантов
  multiple: boolean;
};

export type MultipleChoiceAnswer = {
  selected: string[];
};

// ---------- Общие типы ----------

// По мере добавления типов сюда дописываются новые варианты через `|`
export type Exercise = MultipleChoiceExercise;
export type PublicExercise = PublicMultipleChoice;

// Результат проверки, одинаковый для всех типов
export type CheckResult = {
  // Доля правильности от 0 до 1 — позволяет учитывать частично верные ответы
  score: number;
  isCorrect: boolean;
  explanation: string;
};
