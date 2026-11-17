"use client";

import type { Term, TermInfo } from "@plotted/engine";

export const HEAVY_LOAD = 18;

/** Region label + status for a semester column (also what tests and screen readers find it by). */
export function termMeta(term: Term, info: TermInfo | undefined, credits: number) {
  const isCredit = term.kind === "credit";
  const status = info?.status;
  return {
    label: `${isCredit ? "Credit before college" : (info?.realLabel ?? term.label)}${
      status ? ` (${status === "in-progress" ? "in progress" : status})` : ""
    }, ${credits} hours`,
    status: status ?? (isCredit ? "credit" : undefined),
  };
}

/** Station name board at the top of a semester column. */
export function TermHead({ term, info, credits }: { term: Term; info?: TermInfo; credits: number }) {
  const isCredit = term.kind === "credit";
  const [yearPart, season] = term.label.split(" · ");
  const heavy = !isCredit && credits > HEAVY_LOAD;
  const status = info?.status;
  const big = isCredit ? "Before college" : (info?.realLabel ?? season);
  const small = isCredit
    ? "AP · dual · transfer"
    : [yearPart, status === "completed" ? "Done" : status === "in-progress" ? "Now" : null].filter(Boolean).join(" · ");

  return (
    <>
      <h3 className="font-mono text-body-sm leading-none font-bold tracking-tight uppercase">
        {status === "completed" && <span aria-hidden>✓ </span>}
        {status === "in-progress" && <span aria-hidden>● </span>}
        {big}
      </h3>
      <p className="mt-1.5 flex items-baseline justify-between gap-2 text-caption text-ink-soft">
        <span>{small}</span>
        <span className={`font-mono tabular-nums ${heavy ? "font-bold text-alert-text" : ""}`}>{credits} hrs</span>
      </p>
      {!isCredit && (
        <div className="load" data-heavy={heavy ? "" : undefined} aria-hidden>
          <i style={{ transform: `scaleX(${Math.min(1, credits / HEAVY_LOAD)})` }} />
        </div>
      )}
      {heavy && (
        <p className="mt-1.5 text-label leading-tight font-semibold tracking-normal text-alert-text">
          <span aria-hidden>▲ </span>Heavy: over {HEAVY_LOAD} hrs
        </p>
      )}
    </>
  );
}

/** Actions at the foot of a semester column. */
export function TermFoot({
  term,
  onAddCourse,
  onRemoveTerm,
  onAddSummer,
}: {
  term: Term;
  onAddCourse?: () => void;
  onRemoveTerm?: () => void;
  onAddSummer?: () => void;
}) {
  const isCredit = term.kind === "credit";
  const empty = term.items.length === 0;
  return (
    <div className="flex flex-col items-start gap-1.5 print:hidden">
      {empty && <p className="text-caption text-ink-soft">{isCredit ? "AP, dual credit, transfer courses" : "Drop a course here"}</p>}
      {onAddCourse && (
        <button type="button" onClick={onAddCourse} className="btn py-0.5 text-body-sm">
          {isCredit ? "＋ Credit" : "＋ Course"}
        </button>
      )}
      {onAddSummer && (
        <button type="button" onClick={onAddSummer} className="text-caption font-medium underline underline-offset-2">
          ＋ Summer after
        </button>
      )}
      {onRemoveTerm && empty && (
        <button type="button" onClick={onRemoveTerm} className="text-caption font-medium text-alert-text underline underline-offset-2">
          Remove semester
        </button>
      )}
    </div>
  );
}
