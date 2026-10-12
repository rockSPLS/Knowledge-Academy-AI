import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Список статей живёт на главной. Редирект временный (307): постоянный браузеры
  // запоминают навсегда, и страницу /articles потом было бы трудно вернуть.
  async redirects() {
    return [{ source: "/articles", destination: "/", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Подключает обработку .mdx-файлов (тексты статей лежат в content/articles/)
const withMDX = createMDX();

export default withMDX(nextConfig);
