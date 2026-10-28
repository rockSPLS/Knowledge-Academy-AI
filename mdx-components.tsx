import type { MDXComponents } from "mdx/types";
import { Exercise } from "@/components/exercises/Exercise";
import { headingId, textOf } from "@/lib/search/anchors";

// Оформление текста всех MDX-статей и компоненты, доступные внутри них.
// Цвета — только через дизайн-токены (app/globals.css), чтобы работали обе темы.

const components = {
  // id раздела — для ссылок-источников поиска (/articles/<slug>#<id>).
  // scroll-mt: при переходе по ссылке заголовок не прижимается к самому краю окна
  h2: (props) => (
    <h2
      id={headingId(textOf(props.children))}
      className="mt-12 mb-3 scroll-mt-6 text-2xl font-semibold"
      {...props}
    />
  ),
  h3: (props) => <h3 className="mt-8 mb-2 text-xl font-semibold" {...props} />,
  p: (props) => <p className="my-4 leading-7" {...props} />,
  ul: (props) => <ul className="my-4 list-disc space-y-2 pl-6 marker:text-subtle" {...props} />,
  ol: (props) => (
    <ol className="my-4 list-decimal space-y-2 pl-6 marker:text-subtle" {...props} />
  ),
  li: (props) => <li className="leading-7" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  a: (props) => (
    <a className="text-accent underline underline-offset-4 hover:text-accent-hover" {...props} />
  ),
  blockquote: (props) => (
    <blockquote
      className="my-4 border-l-4 border-accent bg-surface py-2 pr-4 pl-4 text-muted"
      {...props}
    />
  ),
  pre: (props) => (
    <pre
      className="my-4 overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-sm [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]"
      {...props}
    />
  ),
  // Код внутри текста; внутри блока кода (pre) эти рамка и фон сбрасываются
  code: (props) => (
    <code
      className="rounded border border-border bg-surface px-1 py-0.5 font-mono text-[0.9em]"
      {...props}
    />
  ),
  // Компоненты, доступные внутри статей без импорта
  Exercise,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
