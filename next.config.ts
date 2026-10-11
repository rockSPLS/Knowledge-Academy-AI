import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* здесь задаются параметры конфигурации */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
