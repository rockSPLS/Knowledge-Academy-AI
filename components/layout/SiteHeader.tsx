import Link from "next/link";
import { LogoMark } from "./LogoMark";
import { SearchToggle } from "@/components/search/SearchToggle";
import { NavLink } from "./NavLink";
import { ThemeToggle } from "./ThemeToggle";

// Шапка сайта. Слева знак и название, справа — место для действий на любой странице:
// кнопка-лупа поиска, «Пройти тест», «Прогресс», «Путешествие» и переключатель темы.
// «Путешествие» — главное действие — последней из ссылок, рядом с переключателем темы.
// Название сайта рядом со знаком — мелко в три строки, по высоте не больше знака: в одну
// строку оно вместе с пятью кнопками в колонку сайта (768 px) не помещается.
// На телефоне (до sm, 640 px) знак и пять кнопок в одну строку не помещаются: шапка
// в две строки — сверху знак с названием, лупа и тема, снизу ссылки («Пройти тест»
// сокращается до «Тест»). Ссылки обёрнуты в свою группу только на телефоне: с sm группа
// «растворяется» (contents), и порядок в строке задают классы order.

const LINK = "whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3";

export function SiteHeader() {
  return (
    <header className="border-b border-border print:hidden">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3 sm:flex-nowrap sm:gap-2">
        <Link href="/" className="order-1 mr-auto inline-flex items-center gap-2 font-semibold hover:text-accent">
          {/* На телефоне знак чуть меньше (30 px), на 320 px он не сжимается */}
          <LogoMark size={36} className="h-[30px] w-[90px] shrink-0 sm:h-9 sm:w-[108px]" />
          {/* Три строки высотой со знак: 3 × 10 px на телефоне, 3 × 12 px с sm. Пробелы между
              словами — чтобы экранный диктор прочёл название целиком */}
          <span className="text-[11px] leading-[10px] sm:text-xs sm:leading-3">
            <span className="block">Prompt</span> <span className="block">Engineering</span>{" "}
            <span className="block">Academy</span>
          </span>
        </Link>
        <div className="order-2">
          <SearchToggle />
        </div>
        <div className="order-4 flex w-full gap-1 sm:contents">
          <NavLink href="/test" className={`${LINK} border border-border-strong hover:bg-surface sm:order-3`}>
            <span className="sm:hidden">Тест</span>
            <span className="hidden sm:inline">Пройти тест</span>
          </NavLink>
          <NavLink href="/progress" className={`${LINK} border border-border-strong hover:bg-surface sm:order-4`}>
            Прогресс
          </NavLink>
          <NavLink
            href="/journey"
            className={`${LINK} bg-accent-fill text-accent-fill-foreground hover:bg-accent-fill-hover sm:order-5`}
          >
            Путешествие
          </NavLink>
        </div>
        <div className="order-3 sm:order-6">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
