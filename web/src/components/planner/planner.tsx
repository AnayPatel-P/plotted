"use client";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  type Course,
  evaluate,
  type PlanItem,
  type Program,
  prereqEdges,
  type RuleResult,
  routeOf,
  type Status,
} from "@plotted/engine";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { clearSaved, emptyTerms, loadSaved, reducer, save, storageKey } from "@/lib/plan-state";
import { CourseDialog, type DialogTarget } from "./course-dialog";
import { PlanItemChip, type RouteRole } from "./plan-item";
import { RequirementsPanel } from "./requirements-panel";
import { RouteOverlay } from "./route-overlay";
import { StatusMark } from "./status-mark";
import { TermCard } from "./term-card";

interface Props {
  program: Program;
  courses: Course[];
  school: string;
  year: string;
  schoolName: string;
}

function walkRules(r: RuleResult, fn: (r: RuleResult) => void) {
  fn(r);
  r.children?.forEach((c) => walkRules(c, fn));
}

const yearOf = (label: string) => Number(label.match(/Year (\d+)/)?.[1] ?? 0);

export function Planner({ program, courses, school, year, schoolName }: Props) {
  const key = storageKey(school, year, program.id);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initial plan: explicit start choice from the picker, else the saved plan, else the catalog's suggested plan.
  // This component renders only in the browser (see planner-client.tsx), so storage is available here.
  const [initial] = useState(() => {
    const start = searchParams.get("start");
    if (start === "empty") return { state: { terms: emptyTerms(), extraCourses: [] }, savedAt: null };
    if (start === "suggested") return { state: { terms: program.suggestedPlan, extraCourses: [] }, savedAt: null };
    const saved = loadSaved(key);
    return saved
      ? { state: { terms: saved.terms, extraCourses: saved.extraCourses }, savedAt: saved.savedAt }
      : { state: { terms: program.suggestedPlan, extraCourses: [] }, savedAt: null };
  });
  const [state, dispatch] = useReducer(reducer, initial.state);
  const [savedAt, setSavedAt] = useState<string | null>(initial.savedAt);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverRule, setHoverRule] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [dragging, setDragging] = useState<PlanItem | null>(null);
  const [mobileYear, setMobileYear] = useState(1);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const reqDialog = useRef<HTMLDialogElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Drop ?start= from the URL so a reload doesn't reset the plan again.
  useEffect(() => {
    if (searchParams.get("start")) router.replace(pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  // Save after every change (debounced).
  const first = useRef(true);
  useEffect(() => {
    if (first.current && !searchParams.get("start")) {
      first.current = false;
      return;
    }
    first.current = false;
    const t = setTimeout(() => {
      save(key, state);
      setSavedAt(new Date().toISOString());
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only plan changes should trigger a save
  }, [state, key]);

  const courseMap = useMemo(
    () => new Map([...courses, ...state.extraCourses].map((c) => [c.code, c])),
    [courses, state.extraCourses],
  );
  const ev = useMemo(() => evaluate(program, courseMap, state.terms), [program, courseMap, state.terms]);
  const edges = useMemo(() => prereqEdges(state.terms, courseMap), [state.terms, courseMap]);
  const route = useMemo(() => (selected ? routeOf(selected, edges) : null), [selected, edges]);

  // Stamp animation for rules that just became Met.
  const prev = useRef<Map<string, Status> | null>(null);
  useEffect(() => {
    const now = new Map<string, Status>();
    ev.areas.forEach((a) => walkRules(a.result, (r) => now.set(r.id, r.status)));
    if (prev.current) {
      const newly = new Set([...now].filter(([id, s]) => s === "met" && prev.current!.get(id) !== "met").map(([id]) => id));
      if (newly.size) {
        setFresh(newly);
        const t = setTimeout(() => setFresh(new Set()), 900);
        prev.current = now;
        return () => clearTimeout(t);
      }
    }
    prev.current = now;
  }, [ev]);

  const ruleItems = useMemo(() => {
    const m = new Map<string, string[]>();
    ev.areas.forEach((a) => walkRules(a.result, (r) => m.set(r.id, r.itemIds)));
    return m;
  }, [ev]);
  const highlighted = new Set(hoverRule ? (ruleItems.get(hoverRule) ?? []) : []);
  const issues = new Map(ev.prereqIssues.map((i) => [i.itemId, i]));
  const itemCode = new Map(
    state.terms.flatMap((t) => t.items.flatMap((i) => (i.kind === "course" ? [[i.id, i.code] as const] : []))),
  );
  const planned = new Set(itemCode.values());

  const roleOf = (id: string): RouteRole => {
    if (!route) return undefined;
    if (id === selected) return "self";
    if (route.upstream.has(id)) return "up";
    if (route.downstream.has(id)) return "down";
    return "dim";
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );
  const onDragStart = (e: DragStartEvent) => {
    setSelected(null);
    setDragging(state.terms.flatMap((t) => t.items).find((i) => i.id === e.active.id) ?? null);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (e.over && e.over.id !== e.active.data.current?.termId) {
      dispatch({ type: "move", itemId: String(e.active.id), toTermId: String(e.over.id) });
    }
  };

  const pick = useCallback(
    (course: Course) => {
      if (!dialog) return;
      dispatch(dialog.mode === "add" ? { type: "add", termId: dialog.id, course } : { type: "fill", slotId: dialog.id, course });
      setDialog(null);
    },
    [dialog],
  );

  const reset = (to: "suggested" | "empty") => {
    const msg = to === "suggested" ? "Replace your plan with the catalog's suggested plan?" : "Clear every semester and start empty?";
    if (!window.confirm(msg)) return;
    clearSaved(key);
    setSelected(null);
    dispatch({ type: "reset", terms: to === "suggested" ? program.suggestedPlan : emptyTerms() });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const years = [...new Set(state.terms.map((t) => yearOf(t.label)))];
  const checked = ev.areas.filter((a) => a.result.status !== "manual");
  const metCount = checked.filter((a) => a.result.status === "met").length;
  const issueCount = ev.prereqIssues.length;
  const routeKey = `${selected}|${state.terms.map((t) => t.items.length).join(",")}|${mobileYear}`;

  const panel = <RequirementsPanel areas={ev.areas} fresh={fresh} onHover={setHoverRule} notes={program.reviewNotes} />;

  return (
    <div className="pb-28 lg:pb-10">
      {/* Masthead */}
      <header className="border-b-2 border-ink">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pt-4 pb-3">
          <div className="min-w-0">
            <Link href="/" className="riso-title text-2xl font-extrabold tracking-tight" style={{ fontVariationSettings: '"wdth" 80' }}>
              PLOTTED
            </Link>
            <h1 className="mt-1 text-[clamp(1.5rem,3.5vw,2.6rem)] leading-[0.95] font-extrabold tracking-tight">
              {program.name}
              <span className="ml-2 align-middle font-mono text-xs font-normal tracking-normal text-ink-soft">
                {schoolName} · {program.catalogYear} catalog
              </span>
            </h1>
          </div>
          <div className="flex items-end gap-4">
            <p className="text-right leading-none">
              <span className="font-mono text-4xl font-medium tabular-nums">{ev.totalCredits}</span>
              <span className="font-mono text-lg text-ink-soft">/{program.totalHours}</span>
              <span className="block font-mono text-[11px] tracking-widest text-ink-soft uppercase">hours planned</span>
            </p>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-full border-2 border-ink px-3 py-1 text-[13px] font-semibold hover:bg-yellow hover:text-on-yellow">
                Plan ▾
              </summary>
              <div className="absolute right-0 z-40 mt-2 w-60 rounded-chip border-2 border-ink bg-card p-2 text-[13px] shadow-[4px_4px_0_0_var(--pink)]">
                <button type="button" onClick={() => reset("suggested")} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-yellow/50 hover:text-on-yellow">
                  Reset to suggested plan
                </button>
                <button type="button" onClick={() => reset("empty")} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-yellow/50 hover:text-on-yellow">
                  Start empty
                </button>
                <a href={program.sourceUrl} target="_blank" rel="noreferrer" className="block rounded-md px-2 py-1.5 hover:bg-yellow/50 hover:text-on-yellow">
                  Open the catalog page ↗
                </a>
              </div>
            </details>
          </div>
        </div>
        <p className="mx-auto max-w-[1500px] px-4 pb-2 text-[12px] text-ink-soft">
          Not an official degree audit. Confirm with your advisor.{" "}
          <span aria-live="polite">{savedAt ? "Saved in this browser." : ""}</span>
        </p>
      </header>

      {/* Mobile year tabs */}
      <nav aria-label="Years" className="sticky top-0 z-30 flex gap-2 overflow-x-auto border-b-2 border-ink bg-paper px-4 py-2 sm:hidden">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            aria-pressed={mobileYear === y}
            onClick={() => setMobileYear(y)}
            className={`shrink-0 rounded-full border-2 border-ink px-4 py-1 font-mono text-sm font-medium ${
              mobileYear === y ? "bg-ink text-paper" : "bg-card"
            }`}
          >
            Year {y}
          </button>
        ))}
      </nav>

      <div className="mx-auto grid max-w-[1500px] gap-6 px-4 pt-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div ref={gridRef} className="relative" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
            {selected && (
              <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <span className="font-semibold">Route for {itemCode.get(selected)}</span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-1 w-6 rounded bg-blue" /> needs
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-1 w-6 rounded bg-pink" /> unlocks
                </span>
                <button type="button" onClick={() => setSelected(null)} className="font-medium text-blue-text underline">
                  Clear
                </button>
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(228px,1fr))]">
              {state.terms.map((term, ti) => {
                const next = state.terms[ti + 1];
                const isSpring = term.label.endsWith("Spring");
                const hasSummerAfter = next?.label.endsWith("Summer");
                return (
                  <div key={term.id} className={yearOf(term.label) === mobileYear ? "" : "max-sm:hidden"}>
                    <TermCard
                      term={term}
                      credits={ev.termCredits[term.id] ?? 0}
                      onAddCourse={() => setDialog({ mode: "add", id: term.id, title: `Add to ${term.label}` })}
                      onRemoveTerm={state.terms.length > 1 ? () => dispatch({ type: "removeTerm", termId: term.id }) : undefined}
                      onAddSummer={isSpring && !hasSummerAfter ? () => dispatch({ type: "addTerm", season: "Summer", afterTermId: term.id }) : undefined}
                    >
                      {term.items.map((item) => (
                        <PlanItemChip
                          key={item.id}
                          item={item}
                          course={item.kind === "course" ? courseMap.get(item.code) : undefined}
                          issue={issues.get(item.id)}
                          route={roleOf(item.id)}
                          highlighted={highlighted.has(item.id)}
                          selected={selected === item.id}
                          terms={state.terms}
                          termId={term.id}
                          onSelect={() => setSelected(selected === item.id ? null : item.id)}
                          onFillSlot={() =>
                            item.kind === "slot" &&
                            setDialog({
                              mode: "fill",
                              id: item.id,
                              title: `${item.label} · ${item.credits} hrs`,
                              filter: item.filter,
                              credits: item.credits,
                            })
                          }
                          onMove={(to) => {
                            dispatch({ type: "move", itemId: item.id, toTermId: to });
                            setMobileYear(yearOf(state.terms.find((t) => t.id === to)!.label));
                          }}
                          onRemove={() => {
                            dispatch({ type: "remove", itemId: item.id });
                            setSelected(null);
                          }}
                          routeSummary={
                            selected === item.id && route
                              ? {
                                  needs: [...route.upstream].map((id) => itemCode.get(id) ?? ""),
                                  unlocks: [...route.downstream].map((id) => itemCode.get(id) ?? ""),
                                }
                              : undefined
                          }
                        />
                      ))}
                    </TermCard>
                  </div>
                );
              })}
              <div className={`grid place-items-center rounded-card border-2 border-dashed border-rule p-6 ${yearOf(state.terms.at(-1)?.label ?? "") === mobileYear ? "" : "max-sm:hidden"}`}>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "addTerm", season: "Fall" })}
                  className="rounded-full border-2 border-ink bg-card px-4 py-2 font-semibold shadow-[3px_3px_0_0_var(--pink)] hover:-translate-y-px"
                >
                  ＋ Add semester
                </button>
              </div>
            </div>
            {route && route.edges.length > 0 && (
              <RouteOverlay container={gridRef} edges={route.edges} downstream={route.downstream} version={routeKey} />
            )}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
            {dragging && (
              <div className={`${dragging.kind === "slot" ? "punchout bg-card" : "sticker"} px-2.5 py-1.5`} data-lifted="true">
                <span className="font-mono text-[13px] font-medium">{dragging.kind === "course" ? dragging.code : dragging.label}</span>
                {dragging.kind === "course" && (
                  <span className="block text-[12px] text-ink-soft">{courseMap.get(dragging.code)?.title}</span>
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>

        <aside aria-label="Requirements" className="hidden lg:block">
          <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto pr-1 pb-4">
            <h2 className="mb-3 flex items-baseline justify-between">
              <span className="text-xl font-extrabold tracking-tight">Requirements</span>
              <span className="font-mono text-[12px] text-ink-soft">
                {metCount}/{checked.length} areas met
              </span>
            </h2>
            {panel}
          </div>
        </aside>
      </div>

      {/* Mobile requirements bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink bg-paper px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={() => reqDialog.current?.showModal()}
          className="flex w-full items-center justify-between gap-3 rounded-full border-2 border-ink bg-card px-4 py-2 shadow-[3px_3px_0_0_var(--blue)]"
        >
          <span className="font-bold">Requirements</span>
          <span className="flex items-center gap-2 font-mono text-[12px]">
            {metCount}/{checked.length} met
            {issueCount > 0 && <span className="text-pink-text">✕ {issueCount} prereq</span>}
            <StatusMark status={metCount === checked.length ? "met" : "partial"} />
          </span>
        </button>
      </div>
      <dialog
        ref={reqDialog}
        onClick={(e) => e.target === reqDialog.current && reqDialog.current?.close()}
        className="mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-card border-2 border-ink bg-paper p-0 text-ink backdrop:bg-ink/40"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-ink bg-paper px-4 py-3">
          <h2 className="text-xl font-extrabold">Requirements</h2>
          <button type="button" onClick={() => reqDialog.current?.close()} className="rounded-full border-2 border-ink px-3 py-0.5 font-bold" aria-label="Close requirements">
            ✕
          </button>
        </div>
        <div className="p-4">{panel}</div>
      </dialog>

      <CourseDialog target={dialog} school={school} year={year} planned={planned} onPick={pick} onClose={() => setDialog(null)} />
    </div>
  );
}
