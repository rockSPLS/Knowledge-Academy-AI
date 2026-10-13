import { Check, CircleAlert, X, type LucideIcon } from "lucide-react";

// Общие отметки разбора ответа для всех типов упражнений: значок + слово, а не только цвет.
// Цвета — из токенов итогов: зелёный — верно, красный — ошибка, янтарный — пропущено.

export type ReviewMarkKind = "correct" | "wrong" | "missed";

export type ReviewMark = {
  Icon: LucideIcon;
  // Рамка и фон элемента ответа
  box: string;
  // Цвет значка и подписи
  text: string;
};

export const REVIEW_MARKS: Record<ReviewMarkKind, ReviewMark> = {
  correct: { Icon: Check, box: "border-success-border bg-success-soft", text: "text-success" },
  wrong: { Icon: X, box: "border-danger-border bg-danger-soft", text: "text-danger" },
  missed: {
    Icon: CircleAlert,
    box: "border-warning-border bg-warning-soft",
    text: "text-warning",
  },
};
