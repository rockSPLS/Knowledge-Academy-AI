"use client";

import type { ComponentProps, MouseEvent } from "react";
import Link from "next/link";

// Ссылка-источник: на раздел статьи (/articles/…#раздел), на начало статьи или на путешествие.
// Если адрес ссылки вместе с #якорем совпадает с текущим, Next.js ничего не делает: страница
// не прокручивается. Так было при повторном клике по источнику и при клике по «К разделу»
// у упражнения, когда его раздел уже открыт. Тогда прокручиваем сами — к заголовку раздела,
// а без якоря — к началу страницы. Клик с Ctrl, Shift и колесиком работает как обычно.
export function ScrollLink({ href, onClick, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const target = new URL(href, window.location.href);
    const here = window.location;
    if (target.pathname !== here.pathname || target.search !== here.search || target.hash !== here.hash) return;
    event.preventDefault();
    // Сразу, без ожидания кадра: на узком экране панель поиска в onClick уже закрывается,
    // а запрет прокрутки под ней мешает только прокрутке рукой, не из кода
    const id = decodeURIComponent(target.hash.slice(1));
    const element = id ? document.getElementById(id) : null;
    if (element) element.scrollIntoView();
    else window.scrollTo(0, 0);
  }

  return <Link href={href} onClick={handleClick} {...props} />;
}
