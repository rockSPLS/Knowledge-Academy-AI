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
  // Сколько вариантов можно отметить (= число верных). 1 — обычный выбор одного ответа.
  // Пользователю число заранее не показывается, это только ограничение интерфейса.
  maxSelections: number;
};

export type MultipleChoiceAnswer = {
  selected: string[];
};

// ---------- Общие типы ----------

// По мере добавления типов сюда дописываются новые варианты через `|`
export type Exercise = MultipleChoiceExercise;
export type PublicExercise = PublicMultipleChoice;

// Итог проверки: верно (балл 1), частично верно (между 0 и 1), неверно (0)
export type Verdict = "correct" | "partial" | "incorrect";

// Результат проверки, одинаковый для всех типов
export type CheckResult = {
  // Доля правильно выполненных элементов ответа — от 0 до 1
  score: number;
  verdict: Verdict;
  explanation: string;
};
