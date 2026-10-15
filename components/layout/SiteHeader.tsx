import Link from "next/link";
import { LogoMark } from "./LogoMark";
import { NavLink } from "./NavLink";
import { ThemeToggle } from "./ThemeToggle";

// Шапка сайта. Правая часть — место для действий на любой странице:
// сейчас там «Пройти тест» и переключатель темы, позже — индикатор прогресса.

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="inline-flex items-center gap-2 font-semibold hover:text-accent">
          <LogoMark size={36} />
          Prompt Engineering Academy
        </Link>
        <div className="flex items-center gap-2">
          <NavLink
            href="/test"
            className="rounded-md bg-accent-fill px-3 py-1.5 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
          >
            Пройти тест
          </NavLink>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
