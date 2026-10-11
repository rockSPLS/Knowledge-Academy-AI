import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold">ИИ без магии: понятно о главном</h1>
        <p className="text-lg text-foreground/70">
          Четыре короткие статьи для новичков: как устроены языковые модели, почему они
          ошибаются, как писать запросы и как безопасно пользоваться ИИ. Каждая идея
          закрепляется упражнением прямо в тексте.
        </p>
      </section>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/articles"
          className="rounded-md bg-foreground px-4 py-2 text-background hover:opacity-90"
        >
          Читать статьи
        </Link>
        <Link
          href="/test"
          className="rounded-md border border-foreground/20 px-4 py-2 hover:bg-foreground/5"
        >
          Пройти тест
        </Link>
      </div>
    </div>
  );
}
