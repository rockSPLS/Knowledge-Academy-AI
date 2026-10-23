"use client";

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Printer } from "lucide-react";
import { ReportContent } from "./JourneyReport";
import type { JourneyProgress } from "./state";

// Отчёт о путешествии — самостоятельная HTML-страница: «Открыть отчёт» показывает её
// в новой вкладке, «Скачать» сохраняет её файлом. Страница не зависит от сайта: стили
// вложены в неё, она всегда светлая и открывается в любом браузере без интернета
// (скачанный файл — системным шрифтом вместо шрифта сайта). Печать — только по кнопке
// на самой странице, сама она не запускается.
//
// Содержимое — те же компоненты, что итоги на сайте (ReportContent): React рисует их
// в отдельный, не вставленный в страницу элемент, и готовые узлы переносятся в новый
// документ. Тексты ответов и модели попадают в него только как текст: React и браузер
// их экранируют, сырой HTML нигде не вставляется. Обычная страница сайта (например,
// /journey/report) не подошла: при «Сохранить как» у неё терялись бы стили сайта.

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

function finishedDate(progress: JourneyProgress): Date | null {
  const date = progress.finishedAt === undefined ? null : new Date(progress.finishedAt);
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

// Шапка страницы отчёта и итоги. Кнопка печати получает обработчик после отрисовки:
// у готового файла нет React, обработчик — атрибут onclick (см. buildReportHtml)
function ReportDocument({ progress }: { progress: JourneyProgress }) {
  const date = finishedDate(progress);
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Prompt Engineering Academy{date && ` · ${date.toLocaleDateString("ru-RU", DATE_FORMAT)}`}
          </p>
          <button
            type="button"
            data-report-print=""
            className="inline-flex items-center gap-2 rounded-md border border-border-strong bg-background px-3 py-1.5 text-sm font-medium hover:bg-border print:hidden"
          >
            <Printer size={16} aria-hidden="true" />
            Печать / PDF
          </button>
        </div>
        <h1 className="text-3xl font-semibold">{progress.journey.title}</h1>
        <p className="text-sm text-muted">Конспекты и вопросы составлены ИИ и могут содержать ошибки.</p>
      </div>
      <ReportContent progress={progress} standalone />
    </main>
  );
}

// Стили сайта одним текстом. Берутся только файлы стилей самого сайта (<link> с его адреса):
// встроенные <style> могут прийти от расширений браузера (например, тёмная тема для всех
// сайтов) и сделали бы отчёт тёмным. Адреса внутри стилей (шрифты) делаются полными:
// в файле стилей они записаны относительно него, а у отчёта своего адреса нет.
// В открытой вкладке шрифт сайта загрузится; скачанный файл почти наверняка покажет
// системный шрифт — браузер не даёт странице с диска брать шрифты с чужого адреса
function collectCss(): string {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    if (!(sheet.ownerNode instanceof HTMLLinkElement) || !sheet.href?.startsWith(`${location.origin}/`)) continue;
    const base = sheet.href;
    try {
      const text = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      parts.push(
        text.replace(/url\((["']?)([^"')]+)\1\)/g, (match, quote: string, address: string) => {
          if (address.startsWith("data:") || address.startsWith("#")) return match;
          try {
            return `url(${quote}${new URL(address, base).href}${quote})`;
          } catch {
            return match;
          }
        }),
      );
    } catch {
      // Правила недоступны (на деле у своих файлов не бывает) — без этого файла
    }
  }
  // Текст стилей записывается в <style> как есть: «</style» внутри закрыл бы его раньше времени
  return parts.join("\n").replace(/<\/style/gi, "<\\/style");
}

export function buildReportHtml(progress: JourneyProgress): string {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<ReportDocument progress={progress} />));
    return toDocumentHtml(progress, container);
  } finally {
    root.unmount();
  }
}

function toDocumentHtml(progress: JourneyProgress, container: HTMLElement): string {
  // Новый документ: заголовок вкладки задаётся текстом, а не разметкой — тоже экранируется
  const doc = document.implementation.createHTMLDocument(`Итоги путешествия — ${progress.journey.title}`);
  doc.documentElement.lang = "ru";
  // Классы <html> сайта задают переменные шрифта. Тему (data-theme) не переносим:
  // отчёт всегда светлый
  doc.documentElement.className = document.documentElement.className;
  const charset = doc.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const viewport = doc.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  const style = doc.createElement("style");
  style.textContent = collectCss();
  doc.head.prepend(charset, viewport);
  doc.head.append(style);
  for (const node of Array.from(container.childNodes)) doc.body.append(doc.importNode(node, true));

  doc.querySelector("[data-report-print]")?.setAttribute("onclick", "window.print()");
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

function reportUrl(progress: JourneyProgress): string {
  return URL.createObjectURL(new Blob([buildReportHtml(progress)], { type: "text/html;charset=utf-8" }));
}

// Адрес открытого отчёта живёт, пока открыта страница сайта: по нему вкладку с отчётом можно
// обновить или сохранить. Прежний освобождается, когда открывают новый
let openedUrl: string | null = null;

// Если новую вкладку открыть нельзя (блокировщик окон, встроенный браузер мессенджера) —
// отчёт скачивается файлом, чтобы нажатие не пропало молча
export function openReport(progress: JourneyProgress): void {
  if (openedUrl) URL.revokeObjectURL(openedUrl);
  openedUrl = reportUrl(progress);
  if (!window.open(openedUrl, "_blank")) downloadReport(progress);
}

// «Итоги путешествия — Фотосинтез — 2026-10-23.html»; знаки, запрещённые в именах файлов, убираются
export function reportFileName(progress: JourneyProgress): string {
  const date = finishedDate(progress) ?? new Date();
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  // Ещё убираются знаки направления текста (ими можно замаскировать расширение файла);
  // обрезка — по символам, а не половинкам эмодзи
  const cleaned = progress.journey.title
    .replace(/[\\/:*?"<>|\u0000-\u001f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = Array.from(cleaned).slice(0, 80).join("").trim();
  return `Итоги путешествия — ${title || "без названия"} — ${day}.html`;
}

export function downloadReport(progress: JourneyProgress): void {
  const url = reportUrl(progress);
  const link = document.createElement("a");
  link.href = url;
  link.download = reportFileName(progress);
  document.body.append(link);
  link.click();
  link.remove();
  // Скачивание уже началось — адрес больше не нужен
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
