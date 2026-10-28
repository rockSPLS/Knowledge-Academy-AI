import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { articles } from "@/lib/articles";
import { getExercise } from "@/lib/exercises/bank";
import { headingId } from "./anchors";
import type { ChunkSource } from "./types";

// Нарезка материалов портала на фрагменты для индекса поиска (вызывает скрипт
// scripts/build-search-index.ts, сайт при работе этого не делает):
// - статья — по разделам «##», текст без MDX-разметки, в начале — путь «Статья › Раздел»;
//   текст до первого «##» — вступление, ссылка на него ведёт на начало статьи;
// - упражнение банка — вопрос и объяснение. Упражнение стоит в MDX сразу после раздела,
//   который проверяет, поэтому привязывается к разделу перед строкой <Exercise id="…" />.

const ARTICLES_DIR = path.join(process.cwd(), "content", "articles");
const EXERCISE_TAG = /^<Exercise\s+id="([^"]+)"\s*\/>$/;

export function buildChunkSources(): ChunkSource[] {
  const chunks: ChunkSource[] = [];
  for (const article of articles) {
    const mdx = readFileSync(path.join(ARTICLES_DIR, `${article.slug}.mdx`), "utf8");
    const sections: { heading: string | null; lines: string[]; exerciseIds: string[] }[] = [
      { heading: null, lines: [], exerciseIds: [] },
    ];
    let inCode = false;
    for (const line of mdx.split(/\r?\n/)) {
      if (line.startsWith("```")) inCode = !inCode;
      const heading = !inCode && /^## (.+)$/.exec(line);
      if (heading) {
        // Без разметки — как текст заголовка на странице, из которого строится якорь
        sections.push({ heading: plainText(heading[1]), lines: [], exerciseIds: [] });
        continue;
      }
      const exercise = !inCode && EXERCISE_TAG.exec(line.trim());
      if (exercise) {
        sections.at(-1)!.exerciseIds.push(exercise[1]);
        continue;
      }
      sections.at(-1)!.lines.push(line);
    }

    const seenIds = new Set<string>();
    for (const section of sections) {
      const sectionId = section.heading ? headingId(section.heading) : "";
      // Одинаковые заголовки в одной статье дали бы одинаковые якоря — ссылка вела бы на первый
      if (section.heading && seenIds.has(sectionId)) {
        throw new Error(`Статья ${article.slug}: повторяется якорь раздела «${sectionId}»`);
      }
      seenIds.add(sectionId);
      const sectionPath = section.heading ? [article.title, section.heading] : [article.title];
      const body = plainText(section.lines.join("\n"));
      if (body) {
        chunks.push(
          withHash({
            id: section.heading ? `section:${article.slug}#${sectionId}` : `section:${article.slug}`,
            kind: "section",
            articleSlug: article.slug,
            sectionId,
            path: sectionPath,
            text: `${sectionPath.join(" › ")}\n\n${body}`,
          }),
        );
      }
      for (const exerciseId of section.exerciseIds) {
        const exercise = getExercise(exerciseId);
        if (!exercise) throw new Error(`Статья ${article.slug}: нет упражнения «${exerciseId}» в банке`);
        chunks.push(
          withHash({
            id: `exercise:${exerciseId}`,
            kind: "exercise",
            articleSlug: article.slug,
            sectionId,
            path: sectionPath,
            exerciseId,
            question: exercise.question,
            text: `${sectionPath.join(" › ")}\nУпражнение: ${exercise.question}\n\n${exercise.explanation}`,
          }),
        );
      }
    }
  }
  return chunks;
}

// Текст раздела без MDX-разметки: без выделения, ссылок, цитат и маркеров списков.
// Содержимое блоков кода (например, шаблон промпта) остаётся — это тоже материал
function plainText(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => !line.startsWith("```"))
    .map((line) =>
      line
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*[-*]\s+/, "")
        .replace(/^#{3,6}\s+/, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\*\*|__|`/g, "")
        .trimEnd(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function withHash(chunk: Omit<ChunkSource, "hash">): ChunkSource {
  return { ...chunk, hash: createHash("sha256").update(chunk.text).digest("hex").slice(0, 16) };
}
