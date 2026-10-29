// Якоря страницы прогресса: блок «Разбор ошибок» (components/review/ReviewBlock.tsx) — к нему ведёт
// «Разобрать ошибки» в конце статьи — и выключатель учёта прогресса в «Ваших данных»
// (components/progress/ProgressApp.tsx) — к нему ведёт «Включить» в блоке разбора.
// Отдельный файл без "use client": значения нужны и серверной странице статьи

export const REVIEW_ANCHOR = "review";
export const PROGRESS_FOR_AI_ANCHOR = "progress-for-ai";
