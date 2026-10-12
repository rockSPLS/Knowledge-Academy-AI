// Типы упражнений. У каждого упражнения есть публичная часть (уходит в браузер)
// и приватная (правильный ответ и объяснение — остаются только на сервере).

// ---------- Выбор ответа ----------

// Вариант ответа, который видит браузер
export type ChoiceOption = {
  id: string;
  text: string;
};

// Вариант ответа в банке: может иметь приватное пояснение, почему он верный
// или неверный. Показывается только при разборе ответа.
export type ChoiceOptionWithFeedback = ChoiceOption & {
  feedback?: string;
};

// Полное упражнение — хранится в банке вопросов на сервере
export type MultipleChoiceExercise = {
  id: string;
  type: "multiple-choice";
  question: string;
  options: ChoiceOptionWithFeedback[];
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

// Разбор ответа по каждому варианту:
// correct — отмечен и верный, wrong — отмечен, но неверный (лишний),
// missed — не отмечен, но верный (пропущен), neutral — не отмечен и неверный.
export type ChoiceOptionStatus = "correct" | "wrong" | "missed" | "neutral";

export type MultipleChoiceReview = {
  type: "multiple-choice";
  options: Record<string, { status: ChoiceOptionStatus; feedback?: string }>;
};

// ---------- Общие типы ----------

// По мере добавления типов сюда дописываются новые варианты через `|`
export type Exercise = MultipleChoiceExercise;
export type PublicExercise = PublicMultipleChoice;
export type ExerciseReviewDetails = MultipleChoiceReview;

// Итог проверки: верно (балл 1), частично верно (между 0 и 1), неверно (0)
export type Verdict = "correct" | "partial" | "incorrect";

// Раскрытие ответа: общее объяснение + разбор, специфичный для типа упражнения.
// Параметр D позволяет обработчику типа вернуть разбор именно своего вида —
// TypeScript не даст по ошибке вернуть разбор другого типа.
export type ExerciseReview<D extends ExerciseReviewDetails = ExerciseReviewDetails> = {
  explanation: string;
  details: D;
};

// Результат проверки, одинаковый для всех типов
export type CheckResult<D extends ExerciseReviewDetails = ExerciseReviewDetails> = {
  // Доля правильно выполненных элементов ответа — от 0 до 1
  score: number;
  verdict: Verdict;
  // Подсказка, которая помогает найти ошибку, но не раскрывает ответ
  hint?: string;
  // Раскрытие ответа. Сервер присылает его, только если ответ верный,
  // если пользователь попросил показать ответ или если это тест.
  review?: ExerciseReview<D>;
};
