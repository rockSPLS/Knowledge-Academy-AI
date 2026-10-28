import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// «← Все статьи» над заголовком страницы — к оглавлению курса на главной. Стоит на странице
// статьи и там, откуда к статьям иначе вернуться только по знаку сайта: путешествия, тест,
// «Мой прогресс». При печати не нужна.
export function BackToArticles() {
  return (
    <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground print:hidden">
      <ArrowLeft size={16} aria-hidden="true" />
      Все статьи
    </Link>
  );
}
