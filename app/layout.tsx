import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SearchProvider } from "@/components/search/SearchProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  // Адрес сайта: из него собираются абсолютные ссылки на обложку превью
  // (на превью-деплоях Vercel подставляет адрес ветки сам)
  metadataBase: new URL("https://knowledge-academy-ai.vercel.app"),
  title: {
    default: "Prompt Engineering Academy",
    template: "%s · Prompt Engineering Academy",
  },
  // Описание видно в превью ссылки (мессенджеры, поисковики): статьи и что делает ИИ —
  // поиск по материалам, разбор ошибок и путешествия
  description:
    "ИИ без магии: статьи о промптах с упражнениями. ИИ найдёт ответ в материалах, разберёт ваши ошибки и составит путешествие по любой теме.",
};

// Выставляет сохранённую тему до первой отрисовки, чтобы страница не мигала светлой
// (приём из руководства Next.js «Preventing flash before hydration»)
const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        {/* Панель поиска — в общем макете: она и ответ остаются открытыми при переходе между страницами */}
        <SearchProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
          <SiteFooter />
        </SearchProvider>
      </body>
    </html>
  );
}
