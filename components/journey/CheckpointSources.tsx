import Link from "next/link";
import { BookOpen } from "lucide-react";
import { KIND_TAG } from "@/components/search/SearchPanel";
import type { CheckpointSource, PublicCheckpoint, PublicJourney } from "@/lib/journey/types";

// Источники под конспектом чекпоинта путешествия по материалам портала: ссылки «Статья › Раздел»
// на разделы статей. Ссылки построил сервер, но путешествие лежит в localStorage браузера,
// поэтому ссылкой становится только адрес раздела статьи портала: чужой адрес из хранилища
// ссылкой не станет. У путешествий по своей теме источников нет — блока тоже.

const ARTICLE_HREF = /^\/articles\/[a-z0-9-]+(#[a-z0-9-]+)?$/;

export function checkpointSources(checkpoint: PublicCheckpoint): CheckpointSource[] {
  if (!Array.isArray(checkpoint.sources)) return [];
  return checkpoint.sources.filter(
    (source): source is CheckpointSource =>
      typeof source === "object" &&
      source !== null &&
      typeof source.href === "string" &&
      ARTICLE_HREF.test(source.href) &&
      Array.isArray(source.path) &&
      source.path.length > 0 &&
      source.path.every((part) => typeof part === "string"),
  );
}

export const isPortalJourney = (journey: PublicJourney) => journey.origin === "portal";

// Пометка под названием: у путешествия по материалам портала — что сверяться есть с чем
export const aiNote = (journey: PublicJourney) =>
  isPortalJourney(journey)
    ? "Конспекты и вопросы составлены ИИ по материалам портала. Сверяйтесь с источниками."
    : "Конспекты и вопросы составлены ИИ и могут содержать ошибки.";

// absolute — для отчёта отдельной страницей: у скачанного файла нет адреса сайта,
// поэтому ссылка — полный адрес, и это обычная ссылка, а не переход внутри сайта
export function CheckpointSources({ checkpoint, absolute = false }: { checkpoint: PublicCheckpoint; absolute?: boolean }) {
  const sources = checkpointSources(checkpoint);
  if (sources.length === 0) return null;
  const linkClass = "text-accent underline-offset-2 hover:underline";
  return (
    <div className="mt-2 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <BookOpen size={14} aria-hidden="true" className="text-accent" />
        Источники
      </p>
      <ul className="mt-1 space-y-1">
        {sources.map((source) => (
          <li key={source.href}>
            {absolute ? (
              <a href={`${window.location.origin}${source.href}`} className={linkClass}>
                {source.path.join(" › ")}
              </a>
            ) : (
              <Link href={source.href} className={linkClass}>
                {source.path.join(" › ")}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Ярлык у названия путешествия и в «Моих путешествиях» — как ярлыки вида в поиске и разборе
export function PortalLabel() {
  return <span className={`${KIND_TAG} inline-block whitespace-nowrap align-middle`}>По материалам портала</span>;
}
