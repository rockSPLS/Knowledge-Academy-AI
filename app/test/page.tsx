import type { Metadata } from "next";
import { Exercise } from "@/components/exercises/Exercise";
import { TestProvider } from "@/components/test/TestContext";
import { TestProgress, TestQuestions, TestSummary } from "@/components/test/TestParts";
import { getAllExerciseIds } from "@/lib/exercises/bank";

export const metadata: Metadata = {
  title: "Тест",
};

export default function TestPage() {
  // В тест входят все вопросы банка — в порядке курса
  const exerciseIds = getAllExerciseIds();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Итоговый тест</h1>
      <p className="text-lg text-muted">
        Вопросы по всем темам курса. Ответ на каждый вопрос принимается сразу, изменить его
        нельзя; итог, разбор и общий счёт появятся, когда вы ответите на все вопросы.
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
