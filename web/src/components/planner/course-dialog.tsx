"use client";

import type { Course, CourseFilter, Improvement } from "@plotted/engine";
import { useEffect, useMemo, useRef, useState } from "react";

export interface DialogTarget {
  mode: "add" | "fill" | "credit";
  /** Term to add to, or slot to fill. */
  id: string;
  title: string;
  filter?: CourseFilter;
  /** Slot size: courses with this many credits are listed first. */
  credits?: number;
  /** Codes from requirements that aren't met yet; ranked first by the server. */
  boost?: string[];
  /**
   * What picking this course would complete (labels), and any prerequisites the plan lacks
   * before that semester, computed against the live plan.
   */
  explain?: (course: Course) => { gains: Improvement[]; needs: string[] };
}

/**
 * Course search in a native <dialog> (focus trap, Esc to close for free).
 * In "fill" mode the results are limited to courses that satisfy the slot.
 */
export function CourseDialog(props: {
  target: DialogTarget | null;
  school: string;
  year: string;
  planned: Set<string>;
  onPick: (course: Course) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { target, onClose } = props;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (target && !d.open) {
      d.showModal();
      d.querySelector<HTMLInputElement>("input[type=search]")?.focus();
    }
    if (!target && d.open) d.close();
  }, [target]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="sheet m-auto w-[min(560px,calc(100vw-24px))] rounded-card shadow-2xl"
    >
      {target && <SearchBody key={`${target.mode}:${target.id}`} {...props} target={target} />}
    </dialog>
  );
}

function SearchBody({
  target,
  school,
  year,
  planned,
  onPick,
  onClose,
}: {
  target: DialogTarget;
  school: string;
  year: string;
  planned: Set<string>;
  onPick: (course: Course) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<{ q: string; total: number; courses: Course[] } | null>(null);
  const [error, setError] = useState(false);
  const tooShort = target.mode !== "fill" && q.trim().length < 2;

  useEffect(() => {
    if (tooShort) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ school, year, q });
      if (target.credits) params.set("credits", String(target.credits));
      if (target.boost?.length) params.set("boost", target.boost.join(","));
      if (target.filter) params.set("filter", JSON.stringify(target.filter));
      try {
        const res = await fetch(`/api/courses?${params}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { total: number; courses: Course[] };
        setData({ q, ...body });
        setError(false);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(true);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, tooShort, target, school, year]);

  const results = useMemo(() => {
    const list = tooShort ? [] : (data?.courses ?? []);
    const withGains = list.map((c, i) => {
      const { gains, needs } = target.explain?.(c) ?? { gains: [], needs: [] };
      // A course whose prerequisites aren't planned yet is never recommended, whatever it would count for.
      return { c, i, needs, gains: needs.length ? [] : gains };
    });
    // Ready courses that complete requirements first, then ones that count toward them, then the
    // server's order; courses still missing prerequisites go last.
    const weight = (g: Improvement[]) => g.reduce((s, x) => s + (x.status === "met" ? 3 : 1), 0);
    return withGains.sort(
      (a, b) => Number(a.needs.length > 0) - Number(b.needs.length > 0) || weight(b.gains) - weight(a.gains) || a.i - b.i,
    );
  }, [data, tooShort, target]);
  const total = tooShort ? 0 : (data?.total ?? 0);
  const loading = !tooShort && !error && data?.q !== q;

  return (
        <div className="flex max-h-[min(640px,85vh)] flex-col">
          <header className="flex items-start justify-between gap-3 border-b-[1.5px] border-ink p-4">
            <div>
              <p className="font-mono text-label text-ink-soft uppercase">
                {target.mode === "add" ? "Add a course" : target.mode === "credit" ? "Credit before college" : "Fill a placeholder"}
              </p>
              <h2 className="text-title-sm leading-tight font-extrabold">{target.title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="btn px-2.5 py-0.5 text-body-sm"
              aria-label="Close"
            >
              ✕
            </button>
          </header>
          <div className="p-4 pb-2">
            <label className="block">
              <span className="sr-only">Search courses by code or title</span>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={
                  target.mode === "fill"
                    ? "Narrow it down (optional)"
                    : target.mode === "credit"
                      ? "Course you have credit for: M 408C, “calculus”…"
                      : "Search: C S 373, “algorithms”, HIST…"
                }
                className="w-full rounded-chip border-[1.5px] border-ink bg-card px-3 py-2 font-mono text-body placeholder:text-ink-soft"
              />
            </label>
            <p className="mt-2 text-caption text-ink-soft" aria-live="polite">
              {error
                ? "Couldn't reach the catalog. Try again."
                : tooShort
                  ? "Type at least 2 characters."
                  : loading
                    ? "Searching the catalog…"
                    : `${total.toLocaleString()} course${total === 1 ? "" : "s"}${total > results.length ? ` · showing ${results.length}` : ""}`}
            </p>
          </div>
          <ul className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {results.map(({ c, gains, needs }) => {
              const inPlan = planned.has(c.code);
              const already = inPlan && target.mode !== "credit";
              return (
                <li key={c.code}>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => onPick(c)}
                    className={`block w-full rounded-chip border-[1.5px] bg-card px-3 py-2 text-left transition-colors hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                      gains.some((g) => g.status === "met") ? "border-ink" : "border-rule"
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-body-sm font-bold">{c.code}</span>
                      <span className="font-mono text-caption text-ink-soft">{c.credits} hrs</span>
                    </span>
                    <span className="block text-body-sm leading-snug">{c.title}</span>
                    {gains.filter((g) => g.status === "met").length > 0 && (
                      <span className="mt-1 block text-caption leading-snug font-semibold text-go-text">
                        <span aria-hidden>★ </span>Completes:{" "}
                        {gains
                          .filter((g) => g.status === "met")
                          .map((g) => g.label)
                          .join(" · ")}
                      </span>
                    )}
                    {gains.filter((g) => g.status !== "met").length > 0 && (
                      <span className="mt-1 block text-caption leading-snug font-medium text-ink">
                        <span aria-hidden>◐ </span>Counts toward:{" "}
                        {gains
                          .filter((g) => g.status !== "met")
                          .map((g) => g.label)
                          .join(" · ")}
                      </span>
                    )}
                    {needs.length > 0 && (
                      <span className="mt-1 block text-caption leading-snug font-semibold text-alert-text">
                        <span aria-hidden>▲ </span>Needs {needs.join(" and ")} earlier in your plan
                      </span>
                    )}
                    <span className="mt-1 flex flex-wrap gap-1 font-mono text-label text-ink-soft">
                      {c.upperDivision && <span className="rounded border border-rule px-1">Upper-division</span>}
                      {c.core.map((k) => (
                        <span key={k} className="rounded border border-rule px-1">
                          Core {k}
                        </span>
                      ))}
                      {already && <span className="rounded border border-rule px-1">Already in plan</span>}
                      {inPlan && !already && <span className="rounded border border-rule px-1">In your plan — moves to credit</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
  );
}
