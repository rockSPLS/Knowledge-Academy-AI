// Список статей портала: метаданные и порядок курса.
// Сами тексты — MDX-файлы в content/articles/<slug>.mdx.

export type ArticleMeta = {
  slug: string;
  // Заголовок статьи на странице
  title: string;
  // Заголовок вкладки браузера и поисковой выдачи
  seoTitle: string;
  description: string;
  // Ключ значка темы на карточке статьи (сами значки — в components/articles/ArticleCard.tsx)
  icon: ArticleIcon;
};

export type ArticleIcon = "cursor" | "ghost" | "blocks" | "shield";

// Порядок важен: статьи образуют цикл «понять → не обмануться → применить → защитить себя».
export const articles: ArticleMeta[] = [
  {
    slug: "how-llm-works",
    title: "Как работают LLM: объяснение без формул",
    seoTitle: "Как работают LLM: объяснение без формул",
    description:
      "Языковая модель не ищет ответ, а предсказывает текст. Разбираем токены, обучение и внимание простыми словами, без математики.",
    icon: "cursor",
  },
  {
    slug: "hallucinations",
    title: "Галлюцинации: что это и как их распознавать",
    seoTitle: "Галлюцинации ИИ: что это и как распознать",
    description:
      "Почему нейросеть уверенно выдаёт неправду, какие бывают галлюцинации и как проверить ответ, чтобы не попасть впросак.",
    icon: "ghost",
  },
  {
    slug: "prompt-structure",
    title: "Структура эффективного промпта",
    seoTitle: "Как написать хороший промпт: структура запроса",
    description:
      "Роль, задача, контекст, формат и примеры: из чего состоит эффективный промпт, с шаблоном и разбором слабого и сильного запроса.",
    icon: "blocks",
  },
  {
    slug: "ai-safety",
    title: "Безопасность при работе с ИИ",
    seoTitle: "Безопасность при работе с ИИ: что нельзя отправлять в чат",
    description:
      "Какие данные не стоит вводить в нейросети, что такое инъекция промпта и как проверять код и ответы перед использованием.",
    icon: "shield",
  },
];

export function getArticle(slug: string): ArticleMeta | undefined {
  return articles.find((article) => article.slug === slug);
}

// Следующая статья курса или undefined, если статья последняя
export function getNextArticle(slug: string): ArticleMeta | undefined {
  const index = articles.findIndex((article) => article.slug === slug);
  return index === -1 ? undefined : articles[index + 1];
}
