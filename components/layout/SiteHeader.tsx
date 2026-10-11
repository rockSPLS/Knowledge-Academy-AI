import Link from "next/link";
import { NavLink } from "./NavLink";

export function SiteHeader() {
  return (
    <header className="border-b border-foreground/10">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
        <Link href="/" className="font-semibold">
          Prompt Engineering Academy
        </Link>
        <nav className="flex gap-6 text-sm">
          <NavLink href="/articles">Статьи</NavLink>
          <NavLink href="/test">Тест</NavLink>
        </nav>
      </div>
    </header>
  );
}
