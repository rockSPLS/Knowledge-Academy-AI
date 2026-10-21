import Link from "next/link";
import { LogoMark } from "./LogoMark";
import { NavLink } from "./NavLink";
import { ThemeToggle } from "./ThemeToggle";

// Шапка сайта. Правая часть — место для действий на любой странице:
// сейчас там «Путешествие», «Пройти тест» и переключатель темы, позже — индикатор прогресса.
// На телефоне название сайта скрыто (остаётся логотип), а «Пройти тест» сокращается
// до «Тест» — иначе три кнопки не помещаются в строку.

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="inline-flex items-center gap-2 font-semibold hover:text-accent">
          <LogoMark size={36} />
          <span className="sr-only sm:not-sr-only">Prompt Engineering Academy</span>
        </Link>
        <div className="flex items-center gap-2">
          <NavLink
            href="/journey"
            className="rounded-md bg-accent-fill px-3 py-1.5 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
          >
            Путешествие
          </NavLink>
          <NavLink
            href="/test"
            className="rounded-md border border-border-strong px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface"
          >
            <span className="sm:hidden">Тест</span>
            <span className="hidden sm:inline">Пройти тест</span>
          </NavLink>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
