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
  improvements,
  openRequirementCodes,
  type PlanItem,
  type Program,
  analyzeSchedule,
  type RuleResult,
  routeOf,
  type Status,
  type Term,
} from "@plotted/engine";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { signInWithGoogle } from "@/lib/cloud";
import { encodePlan } from "@/lib/share-codec";
import { clearSaved, emptyTerms, loadSaved, reducer, save, storageKey } from "@/lib/plan-state";
import { CourseDialog, type DialogTarget } from "./course-dialog";
import { PlanItemChip, type RouteRole } from "./plan-item";
import { PrintSummary } from "./print-summary";
import { RequirementsPanel } from "./requirements-panel";
import { RouteOverlay } from "./route-overlay";
import { StatusMark } from "./status-mark";
import { TermCard } from "./term-card";
import { usePlanSync } from "./use-sync";

interface Props {
  program: Program;
  courses: Course[];
  school: string;
  year: string;
  schoolName: string;
  /** "view" = read-only shared plan: no storage, no account sync, no editing. */
  mode?: "edit" | "view";
  /** The plan to show in view mode. */
  shared?: { terms: Term[]; extraCourses: Course[] };
}

function walkRules(r: RuleResult, fn: (r: RuleResult) => void) {
  fn(r);
  r.children?.forEach((c) => walkRules(c, fn));
}

const yearOf = (label: string) => Number(label.match(/Year (\d+)/)?.[1] ?? 0);

export function Planner({ program, courses, school, year, schoolName, mode = "edit", shared }: Props) {
  const viewOnly = mode === "view";
  const key = storageKey(school, year, program.id);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initial plan: explicit start choice from the picker, else the saved plan, else the catalog's suggested plan.
  // This component renders only in the browser (see planner-client.tsx), so storage is available here.
  const [initial] = useState(() => {
    if (viewOnly) return { state: shared ?? { terms: program.suggestedPlan, extraCourses: [] }, savedAt: null };
    const start = searchParams.get("start");
    if (start === "empty") return { state: { terms: emptyTerms(), extraCourses: [] }, savedAt: null };
    if (start === "suggested") return { state: { terms: program.suggestedPlan, extraCourses: [] }, savedAt: null };
    const saved = loadSaved(key);
    return saved
      ? { state: { terms: saved.terms, extraCourses: saved.extraCourses }, savedAt: saved.savedAt }
      : { state: { terms: program.suggestedPlan, extraCourses: [] }, savedAt: null };
  });
  const [state, dispatch] = useReducer(reducer, initial.state);
  const ref = useMemo(() => ({ school, year, programId: program.id }), [school, year, program.id]);
  const suggestedState = useMemo(() => ({ terms: program.suggestedPlan, extraCourses: [] }), [program]);
  const sync = usePlanSync({ ref, storageKey: key, state, dispatch, suggested: suggestedState, disabled: viewOnly });
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
    if (!viewOnly && searchParams.get("start")) router.replace(pathname, { scroll: false });
  }, [viewOnly, searchParams, router, pathname]);

  // Save after every change (debounced).
  const first = useRef(true);
  useEffect(() => {
    if (viewOnly) return;
    if (first.current && !searchParams.get("start")) {
      first.current = false;
      return;
    }
    first.current = false;
    const t = setTimeout(() => {
      save(key, state, sync.activeId);
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
  const schedule = useMemo(() => analyzeSchedule(state.terms, courseMap), [state.terms, courseMap]);
  const edges = schedule.edges;
  const delayByItem = new Map(schedule.delays.map((d) => [d.itemId, d]));
  const gradTerm = state.terms[schedule.lastTerm];
  const longest = schedule.longestChain;
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

  // For the course picker: rank and label courses by what they'd complete in this plan.
  const suggest = useCallback(
    (mode: "add" | "fill", id: string) => {
      const boost = [...openRequirementCodes(program, ev)];
      const explain = (course: Course) => {
        const item = { kind: "course" as const, id: "__preview", code: course.code };
        const terms =
          mode === "add"
            ? state.terms.map((t) => (t.id === id ? { ...t, items: [...t.items, item] } : t))
            : state.terms.map((t) => ({ ...t, items: t.items.map((i) => (i.id === id ? item : i)) }));
        const map = courseMap.has(course.code) ? courseMap : new Map(courseMap).set(course.code, course);
        return improvements(ev, evaluate(program, map, terms));
      };
      return { boost, explain };
    },
    [program, ev, state.terms, courseMap],
  );

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
    if (!sync.user) clearSaved(key);
    setSelected(null);
    dispatch({ type: "reset", terms: to === "suggested" ? program.suggestedPlan : emptyTerms() });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [toast, setToast] = useState<string | null>(null);
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const share = async () => {
    const url = `${window.location.origin}/share/${school}/${year}/${program.id}#p=${await encodePlan(state.terms)}`;
    try {
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: `${program.name} plan`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      flash("Share link copied. Anyone with it can view this plan (read-only).");
    } catch {
      window.prompt("Copy this share link:", url);
    }
  };

  const copyToMine = () => {
    const existing = loadSaved(key);
    if (existing && !window.confirm(`Replace the ${program.name} plan saved in this browser with this shared plan?`)) return;
    save(key, state, null);
    router.push(`/plan/${school}/${year}/${program.id}`);
  };

  const years = [...new Set(state.terms.map((t) => yearOf(t.label)))];
  const checked = ev.areas.filter((a) => a.result.status !== "manual");
  const metCount = checked.filter((a) => a.result.status === "met").length;
  const issueCount = ev.prereqIssues.length;
  // Big routes (a first math course can lead to half the degree) get tangled: past a dozen
  // lines, draw only the selected course's direct links and its longest chain onward.
  const drawnEdges = useMemo(() => {
    if (!route || !selected) return [];
    if (route.edges.length <= 12) return route.edges;
    const chain = schedule.items.get(selected)?.chain ?? [];
    const chainIds = new Set<string>([selected]);
    let cur = selected;
    for (const code of chain.slice(1)) {
      const next = route.edges.find((e) => e.from === cur && itemCode.get(e.to) === code);
      if (!next) break;
      chainIds.add(next.to);
      cur = next.to;
    }
    return route.edges.filter(
      (e) => e.from === selected || e.to === selected || (chainIds.has(e.from) && chainIds.has(e.to)),
    );
    // itemCode is derived from state.terms, which `route` already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, selected, schedule]);
  const routeKey = `${selected}|${state.terms.map((t) => t.items.length).join(",")}|${mobileYear}`;

  const panel = <RequirementsPanel areas={ev.areas} fresh={fresh} onHover={setHoverRule} notes={program.reviewNotes} />;

  return (
    <div className="pb-28 lg:pb-10 print:pb-0">
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
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2 [&>details]:print:hidden [&>div:not(:first-child)]:print:hidden [&>button]:print:hidden">
            {gradTerm && (
              <div className="text-right leading-none">
                <span className="block font-mono text-[11px] tracking-widest text-ink-soft uppercase">Finishes</span>
                <span className={`text-xl font-extrabold tracking-tight ${schedule.delays.length ? "text-pink-text" : ""}`}>
                  {schedule.delays.length > 0 && <span aria-hidden>▲ </span>}
                  {gradTerm.label.replace("Year", "Yr")}
                </span>
                {longest.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(longest[0]!);
                      setMobileYear(yearOf(state.terms[schedule.items.get(longest[0]!)!.termIndex]!.label));
                    }}
                    className="block font-mono text-[11px] text-blue-text underline"
                  >
                    longest chain: {longest.length} courses
                  </button>
                )}
              </div>
            )}
            <p className="text-right leading-none">
              <span className="font-mono text-4xl font-medium tabular-nums">{ev.totalCredits}</span>
              <span className="font-mono text-lg text-ink-soft">/{program.totalHours}</span>
              <span className="block font-mono text-[11px] tracking-widest text-ink-soft uppercase">hours planned</span>
            </p>
            {viewOnly && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copyToMine}
                  className="rounded-full border-2 border-ink bg-yellow px-3 py-1 text-[13px] font-bold text-on-yellow shadow-[2px_2px_0_0_var(--pink)] hover:-translate-y-px"
                >
                  Copy into my plan
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-full border-2 border-ink px-3 py-1 text-[13px] font-semibold hover:bg-yellow hover:text-on-yellow"
                >
                  Print / PDF
                </button>
              </div>
            )}
            {!viewOnly && sync.enabled && !sync.user && sync.status === "signed-out" && (
              <button
                type="button"
                onClick={async () => {
                  const err = await signInWithGoogle();
                  if (err) window.alert(`Sign-in isn't working yet: ${err}`);
                }}
                className="rounded-full border-2 border-ink bg-card px-3 py-1 text-[13px] font-semibold shadow-[2px_2px_0_0_var(--blue)] hover:-translate-y-px"
              >
                Sign in to sync
              </button>
            )}
            <details className={`relative ${viewOnly ? "hidden" : ""}`}>
              <summary className="cursor-pointer list-none rounded-full border-2 border-ink px-3 py-1 text-[13px] font-semibold hover:bg-yellow hover:text-on-yellow">
                {sync.user ? (sync.plans.find((p) => p.id === sync.activeId)?.name ?? "Plan") : "Plan"} ▾
              </summary>
              <div className="absolute right-0 z-40 mt-2 w-64 rounded-chip border-2 border-ink bg-card p-2 text-[13px] shadow-[4px_4px_0_0_var(--pink)]">
                {sync.user && sync.plans.length > 0 && (
                  <fieldset className="mb-2 border-b-2 border-dashed border-rule pb-2">
                    <legend className="px-2 font-mono text-[10px] tracking-widest text-ink-soft uppercase">Your plans</legend>
                    {sync.plans.map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-yellow/50 hover:text-on-yellow">
                        <input
                          type="radio"
                          name="active-plan"
                          checked={p.id === sync.activeId}
                          onChange={() => {
                            setSelected(null);
                            sync.switchTo(p.id);
                          }}
                        />
                        <span className="truncate">{p.name}</span>
                      </label>
                    ))}
                    <button type="button" onClick={() => sync.newPlan("copy")} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-yellow/50 hover:text-on-yellow">
                      ＋ Save a copy as a new plan
                    </button>
                    <button type="button" onClick={sync.rename} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-yellow/50 hover:text-on-yellow">
                      Rename this plan
                    </button>
                    {sync.plans.length > 1 && (
                      <button type="button" onClick={sync.remove} className="block w-full rounded-md px-2 py-1.5 text-left text-pink-text hover:bg-yellow/50 hover:text-on-yellow">
                        Delete this plan
                      </button>
                    )}
                  </fieldset>
                )}
                <button type="button" onClick={share} className="block w-full rounded-md px-2 py-1.5 text-left font-semibold hover:bg-yellow/50 hover:text-on-yellow">
                  Share a read-only link
                </button>
                <button type="button" onClick={() => window.print()} className="mb-1 block w-full rounded-md border-b-2 border-dashed border-rule px-2 py-1.5 text-left hover:bg-yellow/50 hover:text-on-yellow">
                  Print / Save as PDF
                </button>
                <button type="button" onClick={() => reset("suggested")} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-yellow/50 hover:text-on-yellow">
                  Reset to suggested plan
                </button>
                <button type="button" onClick={() => reset("empty")} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-yellow/50 hover:text-on-yellow">
                  Start empty
                </button>
                <a href={program.sourceUrl} target="_blank" rel="noreferrer" className="block rounded-md px-2 py-1.5 hover:bg-yellow/50 hover:text-on-yellow">
                  Open the catalog page ↗
                </a>
                {sync.user && (
                  <button
                    type="button"
                    onClick={sync.signOut}
                    className="mt-1 block w-full rounded-md border-t-2 border-dashed border-rule px-2 py-1.5 text-left hover:bg-yellow/50 hover:text-on-yellow"
                  >
                    Sign out <span className="block truncate text-[11px] text-ink-soft">{sync.user.email}</span>
                  </button>
                )}
              </div>
            </details>
          </div>
        </div>
        <p className="mx-auto max-w-[1500px] px-4 pb-2 text-[12px] text-ink-soft">
          Not an official degree audit. Confirm with your advisor.{" "}
          <span aria-live="polite" className="print:hidden">
            {viewOnly
              ? "Shared plan — read-only. Copy it to make it yours."
              : sync.status === "synced"
              ? "Synced to your account."
              : sync.status === "saving"
                ? "Saving…"
                : sync.status === "connecting"
                  ? "Connecting to your account…"
                  : sync.status === "error"
                    ? "Couldn't reach your account — saved in this browser for now."
                    : savedAt
                      ? "Saved in this browser."
                      : ""}
          </span>
        </p>
      </header>
      {toast && (
        <div role="status" className="fixed inset-x-0 top-3 z-50 mx-auto w-fit max-w-[calc(100vw-24px)] rounded-full border-2 border-ink bg-card px-4 py-2 text-[13px] font-semibold shadow-[3px_3px_0_0_var(--blue)] print:hidden">
          {toast}
        </div>
      )}
      {sync.notice && (
        <div role="status" className="border-b-2 border-ink bg-yellow text-on-yellow">
          <p className="mx-auto flex max-w-[1500px] items-start justify-between gap-3 px-4 py-2 text-[13px]">
            <span>{sync.notice}</span>
            <button type="button" onClick={sync.dismissNotice} className="font-semibold underline">
              OK
            </button>
          </p>
        </div>
      )}
      {schedule.delays.length > 0 && (
        <div role="status" className="border-b-2 border-ink bg-pink/15">
          <ul className="mx-auto max-w-[1500px] space-y-1 px-4 py-2 text-[13px]">
            {schedule.delays.map((d) => (
              <li key={d.itemId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold text-pink-text">
                  <span aria-hidden>▲ </span>Graduation slips:
                </span>
                <span>
                  <span className="font-mono">{d.chain.join(" → ")}</span> needs {d.termsNeeded} more semester
                  {d.termsNeeded === 1 ? "" : "s"} after {d.code}, but only {d.termsLeft} remain
                  {d.termsLeft === 1 ? "s" : ""}.
                </span>
                <button type="button" onClick={() => setSelected(d.itemId)} className="font-medium text-blue-text underline">
                  Show route
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mobile year tabs */}
      <nav aria-label="Years" className="sticky top-0 z-30 print:hidden flex gap-2 overflow-x-auto border-b-2 border-ink bg-paper px-4 py-2 sm:hidden">
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

      <div className="mx-auto grid max-w-[1500px] gap-6 px-4 pt-5 lg:grid-cols-[minmax(0,1fr)_360px] print:block print:px-0 print:pt-2">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div ref={gridRef} className="relative" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
            {selected && (
              <p className="mb-3 flex print:hidden flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(228px,1fr))] print:grid-cols-4 print:gap-2">
              {state.terms.map((term, ti) => {
                const next = state.terms[ti + 1];
                const isSpring = term.label.endsWith("Spring");
                const hasSummerAfter = next?.label.endsWith("Summer");
                return (
                  <div key={term.id} className={yearOf(term.label) === mobileYear ? "" : "max-sm:hidden print:block"}>
                    <TermCard
                      term={term}
                      credits={ev.termCredits[term.id] ?? 0}
                      onAddCourse={
                        viewOnly
                          ? undefined
                          : () => setDialog({ mode: "add", id: term.id, title: `Add to ${term.label}`, ...suggest("add", term.id) })
                      }
                      onRemoveTerm={!viewOnly && state.terms.length > 1 ? () => dispatch({ type: "removeTerm", termId: term.id }) : undefined}
                      onAddSummer={
                        !viewOnly && isSpring && !hasSummerAfter
                          ? () => dispatch({ type: "addTerm", season: "Summer", afterTermId: term.id })
                          : undefined
                      }
                    >
                      {term.items.map((item) => (
                        <PlanItemChip
                          key={item.id}
                          item={item}
                          course={item.kind === "course" ? courseMap.get(item.code) : undefined}
                          readOnly={viewOnly}
                          issue={issues.get(item.id)}
                          schedule={schedule.items.get(item.id)}
                          delay={delayByItem.get(item.id)}
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
                              ...suggest("fill", item.id),
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
                                  slack: schedule.items.get(item.id)?.slack ?? 0,
                                }
                              : undefined
                          }
                        />
                      ))}
                    </TermCard>
                  </div>
                );
              })}
              <div className={`grid place-items-center rounded-card border-2 border-dashed border-rule p-6 print:hidden ${viewOnly ? "hidden" : ""} ${yearOf(state.terms.at(-1)?.label ?? "") === mobileYear ? "" : "max-sm:hidden"}`}>
                <button
                  type="button"
                  onClick={() => dispatch({ type: "addTerm", season: "Fall" })}
                  className="rounded-full border-2 border-ink bg-card px-4 py-2 font-semibold shadow-[3px_3px_0_0_var(--pink)] hover:-translate-y-px"
                >
                  ＋ Add semester
                </button>
              </div>
            </div>
            <PrintSummary program={program} ev={ev} delays={schedule.delays} schoolName={schoolName} />
            {route && drawnEdges.length > 0 && (
              <RouteOverlay container={gridRef} edges={drawnEdges} downstream={route.downstream} version={routeKey} />
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

        <aside aria-label="Requirements" className="hidden lg:block print:hidden">
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
      <div className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink bg-paper px-4 py-3 lg:hidden print:hidden">
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
