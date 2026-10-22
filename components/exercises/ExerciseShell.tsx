"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  Lightbulb,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { CheckResult, Verdict } from "@/lib/exercises/types";
import { useTestContext } from "@/components/test/TestContext";
import { useJourneyExercise } from "@/components/journey/JourneyExerciseContext";
import { skippedLabel } from "@/components/journey/outcomeLabels";
import type { ExerciseMode, ExerciseStatus } from "./useExercise";

// Итог всегда обозначается значком и словом, а не только цветом —
// так его различают и люди, которые плохо различают цвета (требование доступности WCAG).
// Зелёный, янтарный и красный зарезервированы за итогами и больше нигде не используются —
// поэтому технические ошибки (нет сети) оформлены нейтрально, чтобы их не путали с «Неверно».
export const VERDICTS: Record<Verdict, { Icon: LucideIcon; label: string; className: string }> = {
  correct: { Icon: CircleCheck, label: "Верно", className: "text-success" },
  partial: { Icon: CircleMinus, label: "Частично верно", className: "text-warning" },
  incorrect: { Icon: CircleX, label: "Неверно", className: "text-danger" },
};

// Второстепенные кнопки после неверного ответа. «Попробовать ещё раз» чуть заметнее
// (мягкий индиго): сначала подталкиваем подумать ещё раз, а не подсмотреть ответ.
// Заполненный индиго остаётся только у главного действия — «Проверить».
const SECONDARY_BUTTON =
  "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors aria-disabled:opacity-50";
const RETRY_BUTTON = `${SECONDARY_BUTTON} border-transparent bg-accent-soft text-accent-soft-foreground hover:border-accent`;
const REVEAL_BUTTON = `${SECONDARY_BUTTON} border-border-strong bg-background hover:bg-border`;

// Общая оболочка для всех типов упражнений: метка типа, вопрос, инструкция,
// кнопка проверки и блок результата. Поле для ответа передаётся через children —
// его рисует конкретный тип упражнения (он же подсвечивает варианты при разборе).
// Все типы выглядят одинаково и различаются значком и названием типа.
// В тесте своей кнопки у упражнения нет: все ответы отправляет «Завершить тест»
// (components/test/TestParts.tsx), а карточка подсвечивается, если вопрос пропущен
// или не заполнен при попытке завершить.
// В путешествии карточка — как в статье, плюс кнопка «Подсказка», не больше двух попыток
// и итог «Время вышло», если ответ не успели дать (components/journey/).

// Подписи к подсветке в тесте
const TEST_NOTICES = {
  skipped: "Вы пропустили этот вопрос",
  missing: "Ответьте на этот вопрос",
  incomplete: "Ответ заполнен не полностью",
} as const;

type ExerciseShellProps = {
  // id упражнения: по нему тест подсвечивает карточку и прокручивает к ней
  exerciseId: string;
  typeName: string;
  typeIcon: LucideIcon;
  // Необязательная метка в строке типа (справа), например «★ Задача со звёздочкой» у итогового упражнения
  badge?: { label: string; Icon: LucideIcon };
  question: string;
  // Что нужно сделать, например «Выберите один ответ»
  instruction: string;
  status: ExerciseStatus;
  result: CheckResult | null;
  revealError: boolean;
  // Путешествие: текст ошибки от сервера вместо общего «Не удалось проверить ответ»
  errorMessage?: string | null;
  // Что предложить после ошибки, кроме повторной проверки (свободный ответ — «Пропустить без оценки»)
  errorAction?: React.ReactNode;
  mode: ExerciseMode;
  // Сообщение, если ответ заполнен не полностью (тип показывает его после попытки проверить).
  // Кнопка «Проверить» не блокируется: по клику видно, чего не хватает.
  validationMessage: string | null;
  onSubmit: () => void;
  onRetry: () => void;
  onReveal: () => void;
  children: React.ReactNode;
};

export function ExerciseShell({
  exerciseId,
  typeName,
  typeIcon: TypeIcon,
  badge,
  question,
  instruction,
  status,
  result,
  revealError,
  errorMessage,
  errorAction,
  mode,
  validationMessage,
  onSubmit,
  onRetry,
  onReveal,
  children,
}: ExerciseShellProps) {
  const isAnswered = status === "checked" || status === "revealing";
  // Пропуск без оценки отправляется — кнопка «Проверить» так же недоступна, как при проверке
  const isChecking = status === "checking" || status === "skipping";
  const isRevealing = status === "revealing";
  const resultRef = useRef<HTMLDivElement>(null);
  const revealErrorRef = useRef<HTMLParagraphElement>(null);
  // Номер попытки проверить: сообщение о незаполненном пересоздаётся при каждом клике,
  // чтобы экранный диктор озвучивал его снова, даже если текст не изменился
  const [submitAttempt, setSubmitAttempt] = useState(0);

  // Кнопки исчезают и появляются — переводим фокус на результат после проверки
  // и после раскрытия ответа, чтобы клавиатура и экранный диктор не «потерялись».
  // В тесте — никогда: итоги появляются во всех карточках сразу, и фокус берёт
  // итоговая сводка, где бы она ни стояла на странице.
  // В путешествии, когда время вышло, — тоже: итоги появляются во всех карточках разом.
  const journey = useJourneyExercise();
  const isTimeUp = journey?.isTimeUp ?? false;
  useEffect(() => {
    if (mode === "inline" && result && !isTimeUp) resultRef.current?.focus();
  }, [mode, result, isTimeUp]);

  // Тест: пропущен ли вопрос или не заполнен при попытке завершить (после завершения — нет)
  const test = useTestContext();
  const notice = test && !test.isFinished ? test.noticeFor(exerciseId) : null;
  // id вопроса — имя карточки: тест переводит на неё фокус, и диктор назовёт вопрос
  const questionId = useId();

  // Если раскрыть ответ не удалось — фокус на сообщение об ошибке
  useEffect(() => {
    if (revealError) revealErrorRef.current?.focus();
  }, [revealError]);

  const verdict = result ? VERDICTS[result.verdict] : null;
  // Повтор и раскрытие имеют смысл, только пока ответ не раскрыт:
  // после верного ответа и после «Показать ответ» кнопок нет.
  // В путешествии, когда время вышло, разбор раскрывается сам
  const canRetryOrReveal = mode === "inline" && result !== null && !result.review && !isTimeUp;
  const isSkipped = status === "skipped";
  // Свободный ответ пропущен без оценки по кнопке — кнопка исчезает, фокус переводим на итог
  // (когда время вышло, итоги появляются во всех карточках разом — тогда фокус не трогаем)
  const skippedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSkipped && !isTimeUp) skippedRef.current?.focus();
  }, [isSkipped, isTimeUp]);
  // Путешествие: итог упражнения записан — ответ больше не меняется
  const outcome = journey?.outcomeFor(exerciseId);
  const isSecondAttempt = outcome !== undefined && outcome.attempts > 1;

  return (
    // В тесте data-exercise-id и tabIndex — чтобы тест мог прокрутить к незаполненному вопросу
    // и перевести на него фокус; aria-labelledby — диктор назовёт вопрос
    <section
      data-exercise-id={mode === "test" ? exerciseId : undefined}
      tabIndex={mode === "test" ? -1 : undefined}
      aria-labelledby={mode === "test" ? questionId : undefined}
      // scroll-mt — чтобы при прокрутке к вопросу его не закрыла липкая полоса прогресса теста
      className={`my-8 scroll-mt-24 rounded-xl border bg-surface p-5 outline-none ${
        notice ? "border-accent ring-1 ring-accent" : "border-border"
      }`}
    >
      {/* fieldset + legend связывают варианты ответа с вопросом для экранных дикторов */}
      <fieldset>
        <legend className="w-full">
          {/* Тип — слева, метка сложности — справа, чтобы её не принимали за часть названия
              типа; на узком экране метка переносится на следующую строку */}
          <span className="flex flex-wrap justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent-soft-foreground">
              <TypeIcon size={14} aria-hidden="true" />
              {typeName}
            </span>
            {badge && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-accent px-2 py-1 text-xs font-medium text-accent">
                <badge.Icon size={14} aria-hidden="true" />
                {badge.label}
              </span>
            )}
          </span>
          <span id={questionId} className="mt-4 block font-semibold">
            {question}
          </span>
          <span className="mt-1 block text-sm text-muted">{instruction}</span>
          {notice && (
            <span className="mt-2 flex items-center gap-1.5 text-sm font-medium text-accent">
              <TriangleAlert size={16} aria-hidden="true" />
              {TEST_NOTICES[notice]}
            </span>
          )}
        </legend>
        <div className="mt-4">{children}</div>
      </fieldset>

      {journey && (
        <JourneyHint
          exerciseId={exerciseId}
          canRequest={!result?.review && !isSkipped && !isTimeUp}
        />
      )}

      <div className="mt-4 space-y-3">
        {/* В тесте ответы отправляет общая кнопка «Завершить тест»;
            в путешествии после конца времени ответы отправляются сами */}
        {/* Путешествие: первая попытка уже потрачена (например, до перезагрузки страницы) */}
        {journey && !isAnswered && !isSkipped && !isTimeUp && !outcome &&
          journey.attemptsUsed(exerciseId) >= 1 && (
            <p className="text-sm text-muted">Последняя попытка — после неё откроется разбор.</p>
          )}
        {mode === "inline" && !isAnswered && !isSkipped && !isTimeUp && (
          <button
            type="button"
            onClick={() => {
              if (isChecking) return;
              setSubmitAttempt((n) => n + 1);
              onSubmit();
            }}
            aria-disabled={isChecking}
            className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover aria-disabled:opacity-60"
          >
            {status === "skipping" ? "Пропускаю…" : isChecking ? "Проверяю…" : "Проверить"}
          </button>
        )}

        {/* Нейтральное оформление: красный и янтарный закреплены за итогами */}
        {validationMessage && !isAnswered && !isSkipped && !isTimeUp && (
          <p key={submitAttempt} role="alert" className="inline-flex items-center gap-1.5 text-sm">
            <TriangleAlert size={16} aria-hidden="true" className="text-accent" />
            {validationMessage}
          </p>
        )}

        {/* Тест: ответ ушёл, итог появится после завершения (если часть ответов не дошла,
            видно, какие уже приняты и не меняются) */}
        {mode === "test" && isAnswered && !result && (
          <p className="text-sm text-muted">Ответ отправлен</p>
        )}

        {/* В тесте ошибку объявляет панель «Завершить тест», здесь — только текст */}
        {status === "error" && (
          <p
            role={mode === "inline" ? "alert" : undefined}
            className="flex items-start gap-1.5 text-sm"
          >
            <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
            {mode === "test"
              ? "Не удалось отправить ответ. Нажмите «Завершить тест» ещё раз."
              : (errorMessage ?? "Не удалось проверить ответ. Попробуйте ещё раз.")}
          </p>
        )}
        {status === "error" && !isTimeUp && errorAction}

        {isAnswered && result && verdict && (
          <div ref={resultRef} tabIndex={-1} className="space-y-2 text-sm outline-none">
            {/* Строка итога растянута на всю ширину: справа позже может появиться награда */}
            <div className="flex items-center justify-between gap-4">
              <p className={`inline-flex items-center gap-1.5 font-semibold ${verdict.className}`}>
                <verdict.Icon size={18} aria-hidden="true" />
                {verdict.label}
                {isSecondAttempt && result.review && (
                  <span className="font-normal text-muted">· со второй попытки</span>
                )}
              </p>
            </div>
            {result.hint && <p>{result.hint}</p>}
            {/* Свободный ответ: для экранных дикторов — отзыв по критериям стоит выше итога */}
            {result.feedback && !result.review && (
              <p className="sr-only">Отзыв по каждому критерию — выше.</p>
            )}
            {result.retryHint && !result.review && <p>{result.retryHint}</p>}
            {result.review && (
              <>
                <p className="text-muted">{result.review.explanation}</p>
                {/* Для экранных дикторов: отметки «верно / лишний / пропущен» стоят у вариантов выше */}
                <p className="sr-only">Разбор по каждому элементу ответа отмечен выше.</p>
              </>
            )}
            {revealError && (
              <p
                ref={revealErrorRef}
                role="alert"
                tabIndex={-1}
                className="inline-flex items-center gap-1.5 outline-none"
              >
                <TriangleAlert size={16} aria-hidden="true" className="text-muted" />
                Не удалось загрузить ответ. Попробуйте ещё раз.
              </p>
            )}

            {canRetryOrReveal && (
              <div className="flex flex-wrap gap-2 pt-1">
                {journey && (
                  <p className="w-full text-muted">
                    Осталась ещё одна попытка.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!isRevealing) onRetry();
                  }}
                  aria-disabled={isRevealing}
                  className={RETRY_BUTTON}
                >
                  Попробовать ещё раз
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!isRevealing) onReveal();
                  }}
                  // aria-disabled вместо disabled: заблокированная кнопка сохраняет фокус
                  aria-disabled={isRevealing}
                  className={REVEAL_BUTTON}
                >
                  {isRevealing ? "Загружаю ответ…" : "Показать ответ"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Путешествие: время вышло, ответа нет — итог первой попытки или «не успели» */}
        {isSkipped && outcome && (
          <div ref={skippedRef} tabIndex={-1} className="space-y-2 text-sm outline-none">
            <p className="inline-flex items-center gap-1.5 font-semibold text-muted">
              {outcome.unrated ? (
                <TriangleAlert size={18} aria-hidden="true" />
              ) : (
                <Clock size={18} aria-hidden="true" />
              )}
              {skippedLabel(outcome)}
            </p>
            {!outcome.skipped && (
              <p className={`font-semibold ${VERDICTS[outcome.verdict].className}`}>
                {VERDICTS[outcome.verdict].label}
              </p>
            )}
            {/* В объяснении свободного ответа образец — отдельным абзацем */}
            <p className="whitespace-pre-line text-muted">{outcome.explanation}</p>
          </div>
        )}
      </div>
    </section>
  );
}

// Подсказка в путешествии: открывается по кнопке (цена в очках появится вместе с очками).
// Открытая подсказка остаётся видна и после ответа
function JourneyHint({ exerciseId, canRequest }: { exerciseId: string; canRequest: boolean }) {
  const journey = useJourneyExercise();
  const [state, setState] = useState<"idle" | "loading" | "error" | "opened">("idle");
  const hintRef = useRef<HTMLParagraphElement>(null);
  const hint = journey?.hintFor(exerciseId);

  // Кнопка исчезает — фокус на текст подсказки, чтобы клавиатура не «потерялась»
  useEffect(() => {
    if (hint && state === "opened") hintRef.current?.focus();
  }, [hint, state]);

  if (!journey) return null;

  if (hint) {
    return (
      <p
        ref={hintRef}
        tabIndex={-1}
        className="mt-4 flex items-start gap-2 rounded-lg bg-accent-soft p-3 text-sm text-accent-soft-foreground outline-none"
      >
        <Lightbulb size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          <span className="font-medium">Подсказка: </span>
          {hint}
        </span>
      </p>
    );
  }
  if (!canRequest) return null;

  async function open() {
    if (!journey || state === "loading") return;
    setState("loading");
    try {
      await journey.requestHint(exerciseId);
      setState("opened");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        onClick={open}
        aria-disabled={state === "loading"}
        className={`inline-flex items-center gap-1.5 ${REVEAL_BUTTON}`}
      >
        <Lightbulb size={16} aria-hidden="true" />
        {state === "loading" ? "Загружаю подсказку…" : "Подсказка"}
      </button>
      {state === "error" && (
        <p role="alert" className="flex items-center gap-1.5 text-sm">
          <TriangleAlert size={16} aria-hidden="true" className="text-muted" />
          Не удалось загрузить подсказку. Попробуйте ещё раз.
        </p>
      )}
    </div>
  );
}
