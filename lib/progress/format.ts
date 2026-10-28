// Даты и длительности для прогресса: «28 октября 2026», «1 ч 05 мин», «12 мин», «40 с»

const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };

// Дата — мс с 1970 г. или день ГГГГ-ММ-ДД
export function formatDate(value: number | string): string {
  const date = typeof value === "number" ? new Date(value) : new Date(`${value}T00:00:00`);
  return date.toLocaleDateString("ru-RU", DATE_FORMAT);
}

// День ГГГГ-ММ-ДД по местному времени — так он совпадает с датой, которую видит человек
export function dayOf(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} с`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} мин`;
  return `${Math.floor(minutes / 60)} ч ${String(minutes % 60).padStart(2, "0")} мин`;
}
