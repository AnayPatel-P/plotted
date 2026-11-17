"use client";

import { useDroppable } from "@dnd-kit/core";
import type { Term, TermInfo } from "@plotted/engine";
import type { ReactNode } from "react";

const HEAVY_LOAD = 18;

export function TermCard({
  term,
  info,
  credits,
  children,
  onAddCourse,
  onRemoveTerm,
  onAddSummer,
}: {
  term: Term;
  info?: TermInfo;
  credits: number;
  children: ReactNode;
  onAddCourse?: () => void;
  onRemoveTerm?: () => void;
  onAddSummer?: () => void;
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id: term.id });
  const isCredit = term.kind === "credit";
  const [yearPart, season] = term.label.split(" · ");
  const heavy = !isCredit && credits > HEAVY_LOAD;
  const empty = term.items.length === 0;
  const status = info?.status;
  // With a start term: big real name ("Fall 2026"), small "Year 2 · in progress".
  const big = isCredit ? "Credit" : (info?.realLabel ?? season);
  const small = isCredit
    ? "Before college"
    : [yearPart, status === "completed" ? "Completed" : status === "in-progress" ? "Now" : null].filter(Boolean).join(" · ");

  return (
    <section
      ref={setNodeRef}
      aria-label={`${isCredit ? "Credit before college" : (info?.realLabel ?? term.label)}${
        status ? ` (${status === "in-progress" ? "in progress" : status})` : ""
      }, ${credits} hours`}
      data-status={status ?? (isCredit ? "credit" : undefined)}
      className={`relative flex min-h-48 flex-col rounded-card border-2 p-3 transition-colors duration-200 ${
        isOver
          ? "halftone border-ink bg-card"
          : isCredit
            ? "border-violet bg-violet/5"
            : status === "completed"
              ? "border-ink/50 bg-paper-2"
              : status === "in-progress"
                ? "border-ink bg-yellow/15 shadow-[4px_4px_0_0_var(--yellow)]"
                : "border-ink bg-paper-2/60"
      } ${active && !isOver ? "border-dashed" : ""}`}
    >
      <header className="mb-2 flex items-end justify-between gap-2">
        <h3 className="leading-none">
          <span className="block font-mono text-[11px] tracking-widest text-ink-soft uppercase">
            {status === "completed" && <span aria-hidden>✓ </span>}
            {status === "in-progress" && <span aria-hidden>● </span>}
            {small}
          </span>
          <span className="text-2xl font-extrabold tracking-tight" style={{ fontVariationSettings: '"wdth" 85' }}>
            {big}
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
          {isCredit ? "AP, dual credit, transfer courses" : "Drop a course here"}
        </p>
      )}

      <footer className={`mt-3 flex flex-wrap items-center gap-2 print:hidden ${onAddCourse ? "" : "hidden"}`}>
        <button
          type="button"
          onClick={onAddCourse}
          className="rounded-full border-2 border-ink bg-card px-3 py-1 text-[13px] font-semibold shadow-[2px_2px_0_0_var(--blue)] transition hover:-translate-y-px hover:shadow-[3px_3px_0_0_var(--blue)]"
        >
          {isCredit ? "＋ Credit" : "＋ Course"}
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
