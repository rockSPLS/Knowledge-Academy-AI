import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Тест",
};

export default function TestPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Итоговый тест</h1>
      <p className="text-lg text-foreground/70">
        Вопросы по всем темам портала с подсчётом баллов и итоговой сводкой.
      </p>
      <p className="rounded-lg border border-dashed border-foreground/20 p-4 text-foreground/60">
        Тест появится здесь.
      </p>
    </div>
  );
}
