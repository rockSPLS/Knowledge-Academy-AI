import Link from "next/link";
import { Blocks, Ghost, ShieldCheck, TextCursorInput, type LucideIcon } from "lucide-react";
import type { ArticleIcon, ArticleMeta } from "@/lib/articles";

// Карточка статьи в оглавлении курса: слева полоса со значком темы на всю высоту,
// справа номер шага, название и описание.

const ICONS: Record<ArticleIcon, LucideIcon> = {
  // Курсор — образ «предсказания следующего слова», главной мысли статьи о LLM
  cursor: TextCursorInput,
  ghost: Ghost,
  blocks: Blocks,
  shield: ShieldCheck,
};

type ArticleCardProps = {
  article: ArticleMeta;
  // Номер шага в курсе, начиная с 1
  step: number;
};

export function ArticleCard({ article, step }: ArticleCardProps) {
  const Icon = ICONS[article.icon];

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="group flex overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-accent"
    >
      <span className="flex w-16 shrink-0 items-center justify-center bg-accent-soft text-accent-soft-foreground">
        <Icon size={24} aria-hidden="true" />
      </span>
      {/* min-w-0 и break-words: длинное слово переносится, а не обрезается краем карточки */}
      <span className="min-w-0 flex-1 space-y-1 p-5 break-words">
        <span className="block text-xs font-medium uppercase tracking-wide text-subtle">
          Шаг {step}
        </span>
        <span className="block font-semibold transition-colors group-hover:text-accent">{article.title}</span>
        <span className="block text-sm text-muted">{article.description}</span>
      </span>
    </Link>
  );
}
