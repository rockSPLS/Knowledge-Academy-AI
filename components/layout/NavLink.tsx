"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLinkProps = {
  href: string;
  className: string;
  children: React.ReactNode;
};

// Ссылка навигации, которая сообщает экранным дикторам, что её раздел сейчас открыт.
export function NavLink({ href, className, children }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link href={href} aria-current={isActive ? "page" : undefined} className={className}>
      {children}
    </Link>
  );
}
