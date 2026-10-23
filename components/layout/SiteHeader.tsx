import Link from "next/link";
import { LogoMark } from "./LogoMark";
import { NavLink } from "./NavLink";
import { ThemeToggle } from "./ThemeToggle";

// Шапка сайта. Правая часть — место для действий на любой странице:
// сейчас там «Путешествие», «Пройти тест» и переключатель темы, позже — индикатор прогресса.
// Знак широкий, поэтому до ширины md (768 px) название сайта скрыто (остаётся знак),
// а «Пройти тест» сокращается до «Тест» — иначе всё не помещается в строку.

export function SiteHeader() {
  return (
    <header className="border-b border-border print:hidden">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="inline-flex min-w-0 items-center gap-2 font-semibold hover:text-accent">
          {/* На телефоне знак чуть меньше, чтобы рядом уместились три кнопки (360 px). На совсем
              узком экране (320 px) он может сжаться ещё — рисунок уменьшается целиком, без прокрутки вбок */}
          <LogoMark size={36} className="h-[30px] w-[90px] min-w-0 sm:h-9 sm:w-[108px] sm:shrink-0" />
          <span className="sr-only md:not-sr-only">Prompt Engineering Academy</span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
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
