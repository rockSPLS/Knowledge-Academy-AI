import type { Metadata } from "next";
import Link from "next/link";
import { articles } from "@/lib/articles";

export const metadata: Metadata = {
  title: "Статьи",
};

export default function ArticlesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Статьи</h1>
      <ul className="space-y-3">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={`/articles/${article.slug}`}
              className="block rounded-lg border border-foreground/10 p-4 hover:bg-foreground/5"
            >
              <h2 className="font-medium">{article.title}</h2>
              <p className="mt-1 text-sm text-foreground/60">{article.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
