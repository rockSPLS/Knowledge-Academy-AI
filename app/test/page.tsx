import type { Metadata } from "next";
import { Exercise } from "@/components/exercises/Exercise";
import { TestProvider } from "@/components/test/TestContext";
import { TestProgress, TestQuestions, TestSummary } from "@/components/test/TestParts";
import { getAllExerciseIds } from "@/lib/exercises/bank";

export const metadata: Metadata = {
  title: "Тест",
};

export default function TestPage() {
  // Пока в тест входят все вопросы банка
  const exerciseIds = getAllExerciseIds();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Итоговый тест</h1>
      <p className="text-lg text-muted">
        Вопросы по всем темам портала с подсчётом баллов и итоговой сводкой.
      </p>
      <TestProvider exerciseIds={exerciseIds}>
        <TestProgress />
        <TestQuestions>
          {exerciseIds.map((id) => (
            <Exercise key={id} id={id} />
          ))}
        </TestQuestions>
        <TestSummary />
      </TestProvider>
    </div>
  );
}
