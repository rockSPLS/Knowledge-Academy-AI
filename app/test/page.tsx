import type { Metadata } from "next";
import { Exercise } from "@/components/exercises/Exercise";
import { TestProvider } from "@/components/test/TestContext";
import {
  TestFinish,
  TestProgress,
  TestQuestions,
  TestReview,
  TestScrollButtons,
  TestSummary,
} from "@/components/test/TestParts";
import { getAllExerciseIds } from "@/lib/exercises/bank";
import { getArticleTopics } from "@/lib/progress/topics";

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
        Вопросы по всем темам курса. Ответьте на все и нажмите «Завершить тест» внизу — тогда
        появятся итог, разбор каждого вопроса и общий счёт. До этого ответы можно менять.
      </p>
      <TestProvider exerciseIds={exerciseIds}>
        <TestProgress />
        <TestQuestions>
          {exerciseIds.map((id) => (
            <Exercise key={id} id={id} />
          ))}
          {/* Внутри TestQuestions: при «Пройти заново» панель сбрасывается вместе с вопросами */}
          <TestFinish />
        </TestQuestions>
        <TestSummary />
        {/* Темы статей — для списка «что стоит повторить», если разбора нет: без объяснений */}
        <TestReview articles={getArticleTopics()} />
        <TestScrollButtons />
      </TestProvider>
    </div>
  );
}
