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

// ---------- Улучшите промпт (prompt-rewrite) ----------
// Продвинутый тип: дан слабый промпт и неудачный ответ модели на него — пользователь
// сам переписывает промпт. Проверка без ИИ: по признакам в тексте (рубрика),
// после раскрытия — заготовленный образец сильного промпта.

// Признак сильного промпта (пункт рубрики). Признак найден, если в тексте
// совпал хотя бы один шаблон. Всё приватно: названия признаков подсказывают ответ
export type PromptRewriteCriterion = {
  id: string;
  // Название в разборе, например «Контекст: что есть дома»
  label: string;
  // Как добавить признак, если его не нашли
  howTo: string;
  // Регулярные выражения для нормализованного текста (нижний регистр, «ё» → «е»)
  patterns: RegExp[];
};

export type PromptRewriteExercise = {
  id: string;
  type: "prompt-rewrite";
  // Ситуация: что пользователь хочет получить от модели
  question: string;
  // Слабый промпт — с него начинается поле ввода
  weakPrompt: string;
  // Заготовленный неудачный ответ модели на слабый промпт
  weakAnswer: string;
  // От 2 до 6 признаков
  criteria: PromptRewriteCriterion[];
  // Образец сильного промпта (должен пройти все признаки — проверяется при запуске)
  sample: string;
  explanation: string;
};

export type PublicPromptRewrite = {
  id: string;
  type: "prompt-rewrite";
  question: string;
  weakPrompt: string;
  weakAnswer: string;
};

export type PromptRewriteAnswer = {
  text: string;
};

export type PromptRewriteReview = {
  type: "prompt-rewrite";
  // Признаки в порядке рубрики; howTo — у ненайденных
  criteria: { id: string; label: string; found: boolean; howTo?: string }[];
  sample: string;
};

// ---------- Свободный ответ (free-answer) ----------
// Пользователь отвечает своими словами, ответ оценивает языковая модель по 2–3 критериям,
// которые созданы вместе с вопросом. Есть только в путешествиях: вопрос, критерии
// и образец пишет модель при генерации.

// Вид задания: развёрнутый ответ / объясните простыми словами / объясните другу
// (друг верит в типичное заблуждение) / приведите свой пример. Список — единственный
// в проекте: по нему же строятся схема генерации и проверка упражнения.
// Новый вид — ещё описания в двух промптах (lib/journey/prompts.ts) и компонент
// в components/exercises/types/ с веткой в ExerciseView
export const FREE_ANSWER_KINDS = ["explain", "simple", "friend", "example"] as const;
export type FreeAnswerKind = (typeof FREE_ANSWER_KINDS)[number];

// Критерий: одна мысль, которая должна быть в ответе. Приватен: подсказывает ответ
export type FreeAnswerCriterion = {
  id: string;
  text: string;
};

export type FreeAnswerExercise = {
  id: string;
  type: "free-answer";
  kind: FreeAnswerKind;
  question: string;
  // От 2 до 3 критериев
  criteria: FreeAnswerCriterion[];
  // Образец ответа — показывается только при раскрытии
  sample: string;
  explanation: string;
};

export type PublicFreeAnswer = {
  id: string;
  type: "free-answer";
  kind: FreeAnswerKind;
  question: string;
};

export type FreeAnswerAnswer = {
  text: string;
};

// Отзыв модели по одному критерию: выполнен ли и что получилось или чего не хватает
export type FreeAnswerFeedback = {
  met: boolean;
  feedback: string;
};

export type FreeAnswerReview = {
  type: "free-answer";
  // Критерии в порядке упражнения, с отзывом модели
  criteria: (FreeAnswerFeedback & { id: string; text: string })[];
  sample: string;
};

// ---------- Калибровка уверенности (calibration) ----------
// Собственный тип путешествий: 3–4 коротких вопроса, ответ — своими словами (слово или фраза),
// и у каждого отметка «Точно знаю» или «Сомневаюсь». Ответы оценивает языковая модель
// (верно или нет), очки за уверенность и вывод «когда вы уверены, вы правы в N из M»
// считает сервер. Попытка одна: после разбора уверенность уже не честная.

// Вопрос: правильный короткий ответ — приватный
export type CalibrationItem = {
  id: string;
  question: string;
  answer: string;
};

export type CalibrationExercise = {
  id: string;
  type: "calibration";
  question: string;
  // От 3 до 4 вопросов
  items: CalibrationItem[];
  explanation: string;
};

export type PublicCalibration = {
  id: string;
  type: "calibration";
  question: string;
  items: { id: string; question: string }[];
};

// Ответ на каждый вопрос: текст и уверенность (true — «Точно знаю»)
export type CalibrationAnswer = {
  answers: Record<string, { text: string; confident: boolean }>;
};

// Оценка модели по одному вопросу: верен ли ответ и короткий отзыв
export type CalibrationJudgement = {
  correct: boolean;
  feedback: string;
};

export type CalibrationReview = {
  type: "calibration";
  // По каждому вопросу: уверенность из ответа, оценка модели и правильный ответ.
  // Из пар «уверенность — верно ли» считаются вывод в карточке, а дальше серия и достижения
  items: Record<string, CalibrationJudgement & { confident: boolean; expected: string }>;
};

// ---------- Общие типы ----------

// По мере добавления типов сюда дописываются новые варианты через `|`
export type Exercise =
  | MultipleChoiceExercise
  | TrueFalseExercise
  | FillBlankExercise
  | MatchPairsExercise
  | OrderStepsExercise
  | CostedSelectExercise
  | PromptRewriteExercise
  | FreeAnswerExercise
  | CalibrationExercise;
export type PublicExercise =
  | PublicMultipleChoice
  | PublicTrueFalse
  | PublicFillBlank
  | PublicMatchPairs
  | PublicOrderSteps
  | PublicCostedSelect
  | PublicPromptRewrite
  | PublicFreeAnswer
  | PublicCalibration;
export type ExerciseReviewDetails =
  | MultipleChoiceReview
  | TrueFalseReview
  | FillBlankReview
  | MatchPairsReview
  | OrderStepsReview
  | CostedSelectReview
  | PromptRewriteReview
  | FreeAnswerReview
  | CalibrationReview;

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
  // Свободный ответ: отзыв модели по каждому критерию (что получилось, чего не хватает).
  // Сами критерии и образец не называет, поэтому приходит и до раскрытия ответа
  feedback?: FreeAnswerFeedback[];
  // Раскрытие ответа. Сервер присылает его, только если ответ верный,
  // если пользователь попросил показать ответ или если это тест.
  review?: ExerciseReview<D>;
};
