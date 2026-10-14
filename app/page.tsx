import { Fragment } from "react";
import { ArticleCard } from "@/components/articles/ArticleCard";
import { articles } from "@/lib/articles";

// Главная — оглавление курса: вступление и статьи по порядку.

export default function HomePage() {
  return (
    <div className="space-y-10">
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
