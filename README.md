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

Главная страница находится в `app/page.tsx` — изменения в ней подхватываются автоматически.

## Команды

| Команда | Описание |
| --- | --- |
| `npm run dev` | Сервер для разработки |
| `npm run build` | Production-сборка |
| `npm run start` | Запуск собранного приложения |
| `npm run lint` | Проверка кода ESLint |

## Структура

- `app/` — страницы и макеты (App Router): главная, `/articles`, `/articles/[slug]`, `/test`
- `components/` — React-компоненты (`layout/` — шапка, подвал, навигация)
- `lib/` — данные и вспомогательный код (список статей)

## Окончания строк

В репозитории файлы хранятся с LF, при checkout Git подставляет окончания, принятые в системе: CRLF на Windows, LF на macOS и Linux. Правила заданы в `.gitattributes`.

## Полезные ссылки

- [Документация Next.js](https://nextjs.org/docs)
- [Интерактивный курс Learn Next.js](https://nextjs.org/learn)
