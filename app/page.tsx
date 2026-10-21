import { Fragment } from "react";
import Link from "next/link";
import { Route } from "lucide-react";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { articles } from "@/lib/articles";

// Главная: сверху — приглашение в путешествие по знаниям, дальше оглавление курса:
// вступление и статьи по порядку.

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section
        aria-labelledby="journey-heading"
        className="space-y-3 rounded-xl bg-accent-soft p-5 text-accent-soft-foreground"
      >
        {/* Не заголовок: приглашение стоит над главным заголовком страницы (h1) */}
        <p id="journey-heading" className="flex items-center gap-2 text-lg font-semibold">
          <Route size={20} aria-hidden="true" />
          Путешествие по знаниям
        </p>
        <p>
          Введите тему или вставьте текст — ИИ составит маршрут из чекпоинтов с конспектом
          и упражнениями на время.
        </p>
        <Link
          href="/journey"
          className="inline-block rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
        >
          Начать путешествие
        </Link>
      </section>

      <section className="space-y-4">
        <h1 className="text-3xl font-semibold">ИИ без магии: основы за четыре шага</h1>
        {/* Лозунг курса — шаги из списка статей. Стрелки скрыты от экранного диктора,
            вместо них он прочитает перечисление через запятую */}
        <p className="text-lg font-medium text-accent">
          {articles.map((article, index) => (
            <Fragment key={article.slug}>
              {index > 0 && (
                <>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only">, </span>
                </>
              )}
              {article.stage}
            </Fragment>
          ))}
        </p>
        <p className="text-lg text-muted">
          Четыре короткие статьи для новичков: как устроены языковые модели, почему они
          ошибаются, как писать запросы и как безопасно пользоваться ИИ. Каждая идея
          закрепляется упражнением прямо в тексте.
        </p>
      </section>

      <section aria-labelledby="course-heading" className="space-y-4">
        <h2 id="course-heading" className="text-xl font-semibold">
          Курс
        </h2>
        <ol className="space-y-3">
          {articles.map((article, index) => (
            <li key={article.slug}>
              <ArticleCard article={article} step={index + 1} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
