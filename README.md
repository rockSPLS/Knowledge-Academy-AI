# Prompt Engineering Academy

Проект на [Next.js](https://nextjs.org) (App Router), созданный с помощью [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Стек

- Next.js 16 (App Router, Turbopack)
- React 19
- TypeScript
- Tailwind CSS 4
- ESLint

## Требования

- Node.js 20.9 или новее
- npm

## Запуск

Установите зависимости:

```bash
npm install
```

Запустите сервер для разработки (порт 3001, так как 3000 занят другим проектом):

```bash
npm run dev -- --port 3001
```

Откройте [http://localhost:3001](http://localhost:3001) в браузере.

Главная страница — оглавление курса со статьями по порядку. Тема оформления — светлая, переключатель на тёмную в шапке. Изменения в коде подхватываются автоматически.

## Команды

| Команда | Описание |
| --- | --- |
| `npm run dev` | Сервер для разработки |
| `npm run build` | Production-сборка |
| `npm run start` | Запуск собранного приложения |
| `npm run lint` | Проверка кода ESLint |

## Структура

- `app/` — страницы и макеты (App Router): главная (оглавление курса), `/articles/[slug]`, `/test`; `app/globals.css` — дизайн-токены (цвета светлой и тёмной темы)
- `app/api/check/` — API проверки ответов на упражнения
- `content/articles/` — тексты статей в формате MDX
- `components/exercises/` — упражнения: общая оболочка, хук `useExercise` и компоненты по типам
- `components/test/` — тестовый режим: контекст, прогресс, итоговая сводка
- `components/layout/` — шапка, подвал, навигация, переключатель темы
- `components/articles/` — карточка статьи для оглавления
- `lib/exercises/` — типы упражнений, банк вопросов и серверная проверка ответов
- `lib/articles.ts` — список статей
- `mdx-components.tsx` — оформление статей и компоненты, доступные внутри MDX
- `docs/` — план разработки и журнал решений

Решения, принятые при разработке, и их обоснование — в [docs/decisions-log.md](docs/decisions-log.md).

## Окончания строк

В репозитории файлы хранятся с LF, при checkout Git подставляет окончания, принятые в системе: CRLF на Windows, LF на macOS и Linux. Правила заданы в `.gitattributes`.

## Полезные ссылки

- [Документация Next.js](https://nextjs.org/docs)
- [Интерактивный курс Learn Next.js](https://nextjs.org/learn)
