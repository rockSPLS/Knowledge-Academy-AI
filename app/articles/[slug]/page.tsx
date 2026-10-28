import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { ArticleTimer } from "@/components/progress/ArticleTimer";
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
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Все статьи
      </Link>
      <h1 className="mt-6 text-3xl font-semibold">{article.title}</h1>
      <ArticleContent />

      {/* Переход по курсу: к следующей статье, а после последней — к тесту */}
      <nav aria-label="Продолжение курса" className="mt-12 border-t border-border pt-6">
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
