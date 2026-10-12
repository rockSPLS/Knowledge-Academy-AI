import type { MDXComponents } from "mdx/types";
import { Exercise } from "@/components/exercises/Exercise";

// Компоненты и стили для всех MDX-статей. Оформление временное —
// базовый дизайн ещё предстоит выбрать.

const components = {
  h2: (props) => <h2 className="mt-10 mb-3 text-2xl font-semibold" {...props} />,
  h3: (props) => <h3 className="mt-8 mb-2 text-xl font-semibold" {...props} />,
  p: (props) => <p className="my-4 leading-7" {...props} />,
  ul: (props) => <ul className="my-4 list-disc space-y-2 pl-6" {...props} />,
  ol: (props) => <ol className="my-4 list-decimal space-y-2 pl-6" {...props} />,
  blockquote: (props) => (
    <blockquote className="my-4 border-l-4 border-foreground/20 pl-4 italic" {...props} />
  ),
  pre: (props) => (
    <pre className="my-4 overflow-x-auto rounded-md bg-foreground/5 p-4 text-sm" {...props} />
  ),
  // Компоненты, доступные внутри статей без импорта
  Exercise,
} satisfies MDXComponents;

export function useMDXComponents(): MDXComponents {
  return components;
}
