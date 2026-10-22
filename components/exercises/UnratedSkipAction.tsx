"use client";

import { useJourneyExercise } from "@/components/journey/JourneyExerciseContext";

// Путешествие: ответ, который оценивает ИИ (свободный ответ, калибровка), не удалось оценить —
// модель недоступна. Путешествие не должно на этом застрять: можно пропустить упражнение
// без оценки. Если первая попытка уже была, засчитывается она (как и при конце времени).
// Вне путешествия ничего не рисует.

export function UnratedSkipAction({
  exerciseId,
  onSkip,
  opens,
}: {
  exerciseId: string;
  onSkip: () => void;
  // Что откроется после пропуска — целиком, с глаголом: «Откроется образец ответа»
  opens: string;
}) {
  const journey = useJourneyExercise();
  if (!journey) return null;
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onSkip}
        className="rounded-md border border-border-strong bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-border"
      >
        Пропустить без оценки
      </button>
      <p className="text-sm text-muted">
        {journey.attemptsUsed(exerciseId) >= 1
          ? `${opens}, засчитается первая попытка.`
          : `${opens}, упражнение не засчитается.`}
      </p>
    </div>
  );
}
