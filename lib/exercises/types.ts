// Типы упражнений. У каждого упражнения есть публичная часть (уходит в браузер)
// и приватная (правильный ответ и объяснение — остаются только на сервере).
// Все id (упражнений, вариантов, утверждений, пропусков) публичны — они не должны
// подсказывать ответ (не "correct-option", а "a", "facts-db", "unit").

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

// ---------- Верно или неверно ----------

// Утверждение в банке: правильная оценка и объяснение — приватные
export type TrueFalseStatement = {
  id: string;
  text: string;
  isTrue: boolean;
  explanation: string;
};

export type TrueFalseExercise = {
  id: string;
  type: "true-false";
  question: string;
  // От 1 до 5 утверждений
  statements: TrueFalseStatement[];
  // Общий вывод по всем утверждениям
  explanation: string;
};

export type PublicTrueFalse = {
  id: string;
  type: "true-false";
  question: string;
  statements: { id: string; text: string }[];
};

// Оценка пользователя по каждому утверждению: true — «верно», false — «неверно»
export type TrueFalseAnswer = {
  answers: Record<string, boolean>;
};

export type TrueFalseReview = {
  type: "true-false";
  // isCorrect — верно ли пользователь оценил утверждение; объяснение — у ошибочно оценённых
  statements: Record<string, { isCorrect: boolean; isTrue: boolean; explanation?: string }>;
};

// ---------- Заполните пропуски ----------

// Текст с пропусками: пропуск обозначается как [[id]], например
// «Модель работает не с буквами, а с [[unit]] — кусочками текста».
export type FillBlankExercise = {
  id: string;
  type: "fill-blank";
  question: string;
  text: string;
  // Допустимые ответы для каждого пропуска (формы слова, синонимы) — приватно
  blanks: Record<string, { accepted: string[]; feedback?: string }>;
  explanation: string;
};

// Текст, разбитый на куски: обычный текст и места для пропусков (без ответов)
export type FillBlankPart = { type: "text"; value: string } | { type: "blank"; id: string };

export type PublicFillBlank = {
  id: string;
  type: "fill-blank";
  question: string;
  parts: FillBlankPart[];
};

export type FillBlankAnswer = {
  blanks: Record<string, string>;
};

export type FillBlankReview = {
  type: "fill-blank";
  // expected — эталонный ответ (первый из допустимых); feedback — у неверно заполненных
  blanks: Record<string, { isCorrect: boolean; expected: string; feedback?: string }>;
};

// ---------- Соедините пары ----------

// Термин в банке: может иметь приватное пояснение — показывается, если пара соединена неверно
export type MatchPairsTerm = {
  id: string;
  text: string;
  feedback?: string;
};

export type MatchPairsExercise = {
  id: string;
  type: "match-pairs";
  question: string;
  // От 3 до 6 пар (обычно 3–4)
  terms: MatchPairsTerm[];
  // Порядок определений задаёт автор — так они и лежат в стопке.
  // Он не должен полностью совпадать с порядком терминов (проверяется при запуске).
  definitions: { id: string; text: string }[];
  // Приватно: id термина → id его определения
  correct: Record<string, string>;
  explanation: string;
};

export type PublicMatchPairs = {
  id: string;
  type: "match-pairs";
  question: string;
  terms: { id: string; text: string }[];
  definitions: { id: string; text: string }[];
};

// Какое определение пользователь поставил к каждому термину: id термина → id определения
export type MatchPairsAnswer = {
  matches: Record<string, string>;
};

export type MatchPairsReview = {
  type: "match-pairs";
  // expected — id правильного определения; feedback — у неверно соединённых пар
  terms: Record<string, { isCorrect: boolean; expected: string; feedback?: string }>;
};

// ---------- Расставьте шаги ----------

// Шаг в банке: может иметь приватное пояснение — показывается, если шаг стоит не на месте
export type OrderStep = {
  id: string;
  text: string;
  feedback?: string;
};

export type OrderStepsExercise = {
  id: string;
  type: "order-steps";
  question: string;
  // От 3 до 6 шагов — в том порядке, в каком их видит пользователь.
  // Этот порядок не должен совпадать с верным (проверяется при запуске).
  steps: OrderStep[];
  // Приватно: id шагов в верном порядке
  correct: string[];
  explanation: string;
};

export type PublicOrderSteps = {
  id: string;
  type: "order-steps";
  question: string;
  steps: { id: string; text: string }[];
};

// Порядок, в котором пользователь расставил шаги (id всех шагов)
export type OrderStepsAnswer = {
  order: string[];
};

export type OrderStepsReview = {
  type: "order-steps";
  // isCorrect — шаг стоит в верном порядке относительно других (его не нужно переставлять);
  // position — номер шага в верном порядке (с 1); feedback — у шагов, которые нужно переставить
  steps: Record<string, { isCorrect: boolean; position: number; feedback?: string }>;
};

// ---------- Цена выбора (costed-select) ----------
// Собственный тип: у каждого варианта есть цена в токенах; нужно собрать промпт —
// взять нужное и не набрать «воды». Для итоговых упражнений повышенной сложности.

// Вариант, который видит пользователь: текст и цена в токенах (цена публична)
export type CostedOption = {
  id: string;
  text: string;
  cost: number;
};

// Нужное для задачи, «вода» или то, что нельзя отдавать модели
export type CostedItemKind = "needed" | "noise" | "danger";

// Сведение в банке: одна версия или две (полная и краткая). Версии показываются
// как отдельные варианты вразброс — можно отметить обе, тогда вторая будет дублем.
// Вид сведения и пояснение — приватные
export type CostedSelectItem = {
  id: string;
  versions: CostedOption[];
  kind: CostedItemKind;
  feedback?: string;
};

export type CostedSelectExercise = {
  id: string;
  type: "costed-select";
  // Задача, под которую собирают промпт
  question: string;
  // От 4 до 8 сведений
  items: CostedSelectItem[];
  // Порядок показа: id всех версий. Версии одного сведения не стоят рядом
  // (проверяется при запуске)
  order: string[];
  // Итоговое упражнение повышенной сложности — в карточке метка «★ Задача со звёздочкой»
  starred?: boolean;
  explanation: string;
};

export type PublicCostedSelect = {
  id: string;
  type: "costed-select";
  question: string;
  // Все версии всех сведений — вперемешку, в порядке показа
  options: CostedOption[];
  starred: boolean;
};

// id отмеченных вариантов
export type CostedSelectAnswer = {
  selected: string[];
};

// Разбор варианта:
// needed — нужное, засчитано целиком; needed-long — нужное, но есть версия короче
// (полезна только её часть, остальное — «вода»); duplicate — вторая версия уже взятого
// сведения (целиком «вода»); noise — «вода»; danger — нельзя отдавать модели;
// danger-avoided — опасное, которое верно не взяли (только если элемент «ничего опасного
// не отдали» засчитан); missed — нужное, которое пропустили
// (отмечается у самой короткой версии); neutral — без отметки
export type CostedOptionStatus =
  | "needed"
  | "needed-long"
  | "duplicate"
  | "noise"
  | "danger"
  | "danger-avoided"
  | "missed"
  | "neutral";

export type CostedSelectReview = {
  type: "costed-select";
  options: Record<string, { status: CostedOptionStatus; feedback?: string }>;
  // Состав промпта в токенах: полезное, «вода», опасное
  composition: { useful: number; noise: number; danger: number };
  // Полнота: сколько нужных сведений взято из скольких — показывается рядом с эффективностью,
  // потому что эффективность считается только от набранного и полноту не отражает
  needed: { included: number; total: number };
};

// ---------- Общие типы ----------

// По мере добавления типов сюда дописываются новые варианты через `|`
export type Exercise =
  | MultipleChoiceExercise
  | TrueFalseExercise
  | FillBlankExercise
  | MatchPairsExercise
  | OrderStepsExercise
  | CostedSelectExercise;
export type PublicExercise =
  | PublicMultipleChoice
  | PublicTrueFalse
  | PublicFillBlank
  | PublicMatchPairs
  | PublicOrderSteps
  | PublicCostedSelect;
export type ExerciseReviewDetails =
  | MultipleChoiceReview
  | TrueFalseReview
  | FillBlankReview
  | MatchPairsReview
  | OrderStepsReview
  | CostedSelectReview;

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
  // Подсказка, полезная только для новой попытки (например, «проверьте написание»);
  // после раскрытия ответа не показывается
  retryHint?: string;
  // Раскрытие ответа. Сервер присылает его, только если ответ верный,
  // если пользователь попросил показать ответ или если это тест.
  review?: ExerciseReview<D>;
};
