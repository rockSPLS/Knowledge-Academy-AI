import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">Страница не найдена</h1>
      <p className="text-muted">Такой страницы нет — возможно, ссылка устарела.</p>
      <Link href="/" className="text-accent underline underline-offset-4 hover:text-accent-hover">
        На главную
      </Link>
    </div>
  );
}
