import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { articles, getArticle } from "@/lib/articles";

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

  return (
    <article className="space-y-6">
      <Link href="/articles" className="text-sm text-foreground/60 hover:text-foreground">
        ← Все статьи
      </Link>
      <h1 className="text-3xl font-semibold">{article.title}</h1>
      <p className="text-lg text-foreground/70">{article.description}</p>
      <p className="rounded-lg border border-dashed border-foreground/20 p-4 text-foreground/60">
        Текст статьи с упражнениями появится здесь.
      </p>
    </article>
  );
}
