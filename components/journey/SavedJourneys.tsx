"use client";

import { useRef } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { ConfirmDelete, useConfirmDelete } from "@/components/progress/ConfirmDelete";
import { formatDate } from "@/lib/progress/format";
import { plural } from "@/lib/plural";
import { downloadReport } from "./reportExport";
import { journeyResult } from "./results";
import { removeJourney, type SavedJourney } from "./saved";

// «Мои путешествия» — над формой на странице путешествий: название, дата,
// «в пути · N из M» или «пройдено · N очков», «Продолжить» (у пройденного — «Отчёт»)
// и «Удалить» с подтверждением. У пройденного в подтверждении есть «Скачать»:
// итоги удаляются вместе с путешествием.

export function journeyHref(id: string): string {
  return `/journey?id=${encodeURIComponent(id)}`;
}

// «в пути · 2 из 4» или «пройдено · 85 очков»
export function journeyStatusText(journey: SavedJourney): string {
  const result = journeyResult(journey.progress);
  return result.finished
    ? `пройдено · ${result.points} ${plural(result.points, ["очко", "очка", "очков"])}`
    : `в пути · ${result.checkpointsDone} из ${result.checkpointsTotal}`;
}

// onRemovedLast — удалено последнее путешествие: списка с заголовком больше нет,
// и фокус переводит страница
export function SavedJourneys({ journeys, onRemovedLast }: { journeys: SavedJourney[]; onRemovedLast: () => void }) {
  // После удаления строки с кнопкой нет — фокус переходит на заголовок списка
  const headingRef = useRef<HTMLHeadingElement>(null);
  if (journeys.length === 0) return null;
  return (
    <section aria-labelledby="saved-journeys-heading" className="space-y-3">
      <h2 ref={headingRef} id="saved-journeys-heading" tabIndex={-1} className="text-xl font-semibold outline-none">
        Мои путешествия
      </h2>
      <ul className="space-y-2">
        {journeys.map((journey) => (
          <SavedJourneyItem
            key={journey.id}
            journey={journey}
            onRemoved={() => (journeys.length > 1 ? headingRef.current?.focus() : onRemovedLast())}
          />
        ))}
      </ul>
    </section>
  );
}

function SavedJourneyItem({ journey, onRemoved }: { journey: SavedJourney; onRemoved: () => void }) {
  const { isConfirming, triggerRef, open, cancel } = useConfirmDelete();
  const { title } = journey.progress.journey;
  const finished = journey.progress.stage.kind === "finished";

  return (
    <li className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted">
            {formatDate(journey.createdAt)} · {journeyStatusText(journey)}
          </p>
        </div>
        {!isConfirming && (
          <div className="flex shrink-0 gap-2">
            <Link
              href={journeyHref(journey.id)}
              aria-label={`${finished ? "Отчёт" : "Продолжить"}: ${title}`}
              className="rounded-md bg-accent-fill px-3 py-1.5 text-sm font-medium text-accent-fill-foreground transition-colors hover:bg-accent-fill-hover"
            >
              {finished ? "Отчёт" : "Продолжить"}
            </Link>
            <button
              ref={triggerRef}
              type="button"
              onClick={open}
              aria-label={`Удалить: ${title}`}
              className="rounded-md border border-border-strong bg-background px-3 py-1.5 text-sm font-medium hover:bg-border"
            >
              Удалить
            </button>
          </div>
        )}
      </div>
      {isConfirming && (
        <ConfirmDelete
          message={`Удалить путешествие «${title}»? Отменить нельзя.`}
          onConfirm={() => {
            removeJourney(journey.id);
            onRemoved();
          }}
          onCancel={cancel}
          extra={
            finished && (
              <button
                type="button"
                onClick={() => downloadReport(journey.progress)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-background px-3 py-1.5 font-medium hover:bg-border"
              >
                <Download size={16} aria-hidden="true" />
                Скачать итоги
              </button>
            )
          }
        />
      )}
    </li>
  );
}
