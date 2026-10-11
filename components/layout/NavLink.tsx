"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLinkProps = {
  href: string;
  children: React.ReactNode;
};

// Ссылка навигации, подсвеченная, если открыт её раздел.
export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={
        isActive
          ? "font-medium text-foreground"
          : "text-foreground/60 transition-colors hover:text-foreground"
      }
    >
      {children}
    </Link>
  );
}
