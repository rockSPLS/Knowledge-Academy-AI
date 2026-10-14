// Форма слова по числу: plural(1, ["шаг", "шага", "шагов"]) → «шаг»,
// 3 → «шага», 5 → «шагов», 11 → «шагов», 21 → «шаг».
// Общая для сервера и браузера.
export function plural(count: number, [one, few, many]: [string, string, string]): string {
  const lastTwo = Math.abs(count) % 100;
  const last = lastTwo % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
