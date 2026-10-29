import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { BackToArticles } from "@/components/layout/BackToArticles";
import { ArticleTimer } from "@/components/progress/ArticleTimer";
import { REVIEW_ANCHOR } from "@/components/review/anchors";
import { articles, getArticle, getNextArticle } from "@/lib/articles";

// Все статьи известны заранее — страницы собираются статически при сборке.
// Проверка мгновенной навигации отключена: она ругается на неизвестные адреса,
// а они всё равно ведут на 404. Переходы на настоящие статьи мгновенные.
export const instant = false;

export function generateStaticParams() {
  return articles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/articles/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  return { title: article?.seoTitle, description: article?.description };
}

export default async function ArticlePage({ params }: PageProps<"/articles/[slug]">) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  // Текст статьи — MDX-файл в content/articles/
  const { default: ArticleContent } = await import(`@/content/articles/${slug}.mdx`);
  const nextArticle = getNextArticle(slug);

  return (
    <article>
      {/* Время на статье — в прогресс: пока вкладка видна, с паузой без действий */}
      <ArticleTimer slug={slug} />
      <BackToArticles />
      <h1 className="mt-6 text-3xl font-semibold">{article.title}</h1>
      <ArticleContent />

      {/* Переход по курсу: сначала закрепить статью — путешествие по её разделам (форма с вписанной
          темой, строит путешествие сам человек) и разбор ошибок на странице прогресса, — затем к следующей
          статье, а после последней — к тесту */}
      <nav aria-label="Продолжение курса" className="mt-12 space-y-3 border-t border-border pt-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={`/journey?article=${slug}`}
            className="group rounded-xl border border-border p-4 transition-colors hover:border-accent"
          >
            <span className="block text-sm text-subtle">ИИ составит по разделам статьи</span>
            <span className="block font-semibold group-hover:text-accent">Путешествие по этой статье</span>
          </Link>
          <Link
            href={`/progress#${REVIEW_ANCHOR}`}
            className="group rounded-xl border border-border p-4 transition-colors hover:border-accent"
          >
            <span className="block text-sm text-subtle">ИИ скажет, что повторить</span>
            <span className="block font-semibold group-hover:text-accent">Разобрать ошибки</span>
          </Link>
        </div>
        {nextArticle ? (
          <Link
            href={`/articles/${nextArticle.slug}`}
            className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent"
          >
            <span>
              <span className="block text-sm text-subtle">Следующая статья</span>
              <span className="block font-semibold group-hover:text-accent">
                {nextArticle.title}
              </span>
            </span>
            <ArrowRight size={20} aria-hidden="true" className="shrink-0 text-accent" />
          </Link>
        ) : (
          <Link
            href="/test"
            className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent"
          >
            <span>
              <span className="block text-sm text-subtle">Курс пройден</span>
              <span className="block font-semibold group-hover:text-accent">
                Проверьте себя в итоговом тесте
              </span>
            </span>
            <ArrowRight size={20} aria-hidden="true" className="shrink-0 text-accent" />
          </Link>
        )}
      </nav>
    </article>
  );
}
