import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/layout/LogoMark";

// Обложка превью ссылки (мессенджеры, соцсети): знак и название сайта.
// Тезисы не повторяем — их и так показывает описание под картинкой.
// Next.js собирает картинку при сборке из этой разметки (PNG 1200×630).

export const alt = "Prompt Engineering Academy — человек и ИИ разговаривают, между ними облачко с маршрутом и флажком";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Цвета светлой темы: в генераторе картинок нет CSS-переменных
const LIGHT = { line: "#4f46e5", soft: "#eef2ff", onFill: "#ffffff" };

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 40,
          background: "#ffffff",
        }}
      >
        {/* Знак широкий (3 : 1): 200 в высоту — 600 в ширину, половина обложки */}
        <LogoMark size={200} colors={LIGHT} />
        {/* Встроенный шрифт генератора — только обычного начертания, поэтому без fontWeight */}
        <div style={{ fontSize: 64, color: "#18181b" }}>
          Prompt Engineering Academy
        </div>
      </div>
    ),
    { ...size },
  );
}
