import "server-only";

// Название темы статьи в разборе ошибок — понятное без статьи рядом. Темы разбора — разделы,
// к которым есть упражнения (lib/progress/topics.ts); здесь — те из них, чьё название понятно
// только внутри статьи: с местоимением или общими словами. Название ставит сервер (review.ts):
// правило в промпте модель выполняла не всегда («Почему они возникают», «Как рождается ответ»).
// Раздела нет в списке — его собственное название; вступление статьи — название статьи.
// Новый раздел с упражнением и общим названием — строка здесь

const TITLES: Record<string, string> = {
  "how-llm-works#kak-rozhdaetsya-otvet": "Как языковая модель рождает ответ",
  "how-llm-works#chego-u-modeli-net": "Чего у языковой модели нет",
  "how-llm-works#glavnoe-v-dvukh-strokakh": "Как работают языковые модели: главное",
  "hallucinations#pochemu-oni-voznikayut": "Почему возникают галлюцинации",
  "hallucinations#priznaki-na-kotorye-stoit-obratit-vnimanie": "Признаки галлюцинаций",
  "hallucinations#kak-proveryat": "Как проверять ответы модели",
  "prompt-structure#tipichnye-oshibki": "Типичные ошибки в промптах",
  "prompt-structure#chek-list-pered-otpravkoy": "Чек-лист промпта перед отправкой",
  "ai-safety#glavnoe": "Безопасность при работе с ИИ: главное",
};

// path — [название статьи, раздел]; у вступления — только название статьи
export function topicTitle(articleSlug: string, sectionId: string, path: string[]): string {
  return TITLES[`${articleSlug}#${sectionId}`] ?? path[1] ?? path[0];
}
