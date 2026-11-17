"use client";

import { useDroppable } from "@dnd-kit/core";
import type { Term } from "@plotted/engine";
import type { ReactNode } from "react";

const HEAVY_LOAD = 18;

export function TermCard({
  term,
  credits,
  children,
  onAddCourse,
  onRemoveTerm,
  onAddSummer,
}: {
  term: Term;
  credits: number;
  children: ReactNode;
  onAddCourse?: () => void;
  onRemoveTerm?: () => void;
  onAddSummer?: () => void;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id: term.id });
  const [yearPart, season] = term.label.split(" · ");
  const heavy = credits > HEAVY_LOAD;
  const empty = term.items.length === 0;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${term.label}, ${credits} hours`}
      className={`relative flex min-h-48 flex-col rounded-card border-2 border-ink bg-paper-2/60 p-3 transition-colors duration-200 ${
        isOver ? "halftone bg-card" : active ? "border-dashed" : ""
      }`}
    >
      <header className="mb-2 flex items-end justify-between gap-2">
        <h3 className="leading-none">
          <span className="block font-mono text-[11px] tracking-widest text-ink-soft uppercase">{yearPart}</span>
          <span className="text-2xl font-extrabold tracking-tight" style={{ fontVariationSettings: '"wdth" 85' }}>
            {season}
          </span>
        </h3>
        <p className="text-right leading-none">
          <span className={`font-mono text-2xl font-medium tabular-nums ${heavy ? "text-pink-text" : ""}`}>{credits}</span>
          <span className="block font-mono text-[11px] text-ink-soft">hrs</span>
        </p>
      </header>
      {heavy && (
        <p className="mb-2 rounded-md bg-pink/15 px-2 py-1 text-[12px] font-medium text-pink-text">
          <span aria-hidden>▲ </span>Heavy load: over {HEAVY_LOAD} hours
        </p>
      )}

      <ul className="flex flex-1 flex-col gap-2">{children}</ul>
      {empty && (
        <p className="grid flex-1 place-items-center rounded-chip border-2 border-dashed border-rule py-6 text-center text-[13px] text-ink-soft">
          Drop a course here
        </p>
      )}

      <footer className={`mt-3 flex flex-wrap items-center gap-2 print:hidden ${onAddCourse ? "" : "hidden"}`}>
        <button
          type="button"
          onClick={onAddCourse}
          className="rounded-full border-2 border-ink bg-card px-3 py-1 text-[13px] font-semibold shadow-[2px_2px_0_0_var(--blue)] transition hover:-translate-y-px hover:shadow-[3px_3px_0_0_var(--blue)]"
        >
          ＋ Course
        </button>
        {onAddSummer && (
          <button type="button" onClick={onAddSummer} className="text-[12px] font-medium text-blue-text underline">
            ＋ Summer after
          </button>
        )}
        {onRemoveTerm && empty && (
          <button type="button" onClick={onRemoveTerm} className="ml-auto text-[12px] font-medium text-pink-text underline">
            Remove semester
          </button>
        )}
      </footer>
    </section>
  );
}
