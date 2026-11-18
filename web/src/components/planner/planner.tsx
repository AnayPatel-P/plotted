"use client";

import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
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
  firstChangeableIndex,
  termCalendar,
  type RuleResult,
  routeOf,
  type Status,
  type Term,
  requirementSkeleton,
} from "@plotted/engine";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { track, trackPlanOpened } from "@/lib/analytics";
import { type Answer, answerFor } from "@/lib/answer";
import { signInWithGoogle } from "@/lib/cloud";
import { encodePlan } from "@/lib/share-codec";
import {
  CREDIT_LABEL,
  CREDIT_TERM_ID,
  keepReplaced,
  loadSaved,
  reducer,
  restoreReplaced,
  save,
  storageKey,
  takeReplaced,
  type PlanState,
} from "@/lib/plan-state";
import { CourseDialog, type DialogTarget } from "./course-dialog";
import { Diagram, lineAssignments, linesFor } from "./diagram";
import { FlapBoard } from "./flap-board";
import { PlanItemChip, type RouteRole, StopCard } from "./plan-item";
import { PrintSummary } from "./print-summary";
import { RequirementsPanel } from "./requirements-panel";
import { STATUS, StatusMark } from "./status-mark";
import { TermFoot, TermHead, termMeta } from "./term-card";
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
  shared?: { terms: Term[]; extraCourses: Course[]; startTerm?: string | null };
}

function walkRules(r: RuleResult, fn: (r: RuleResult) => void) {
  fn(r);
  r.children?.forEach((c) => walkRules(c, fn));
}

/** Inlined at build time, so the server and browser agree on it. */
const ACCOUNTS_CONFIGURED = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** The board's third row: one word for where the plan stands. */
function statusWord(a: Answer, delays: number, issues: number): string {
  if (a.tone === "empty") return "NO PLAN";
  if (delays) return "DELAYED";
  if (issues) return `${issues} ALERT${issues === 1 ? "" : "S"}`;
  if (a.tone === "attention") return `${a.open.length} OPEN`;
  return a.tone === "planned" ? "PLANNED" : "ON TIME";
}

/** "Spring 2030", or "YR4 SPRING" before a start term is set. */
const boardTerm = (label: string) => label.replace(/^Year (\d+) · (\w+)$/, "YR$1 $2");

const noopSubscribe = () => () => {};
/** Today's date as YYYY-MM-DD, read only in the browser (keeps the page static at build time). */
const useToday = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => new Date().toISOString().slice(0, 10),
    () => null,
  );

/** Start-term choices: the last six falls/springs and next year's. */
function startTermOptions(today: string | null): string[] {
  const y = today ? Number(today.slice(0, 4)) : 2026;
  const out: string[] = [];
  for (let year = y + 1; year >= y - 6; year--) out.push(`Fall ${year}`, `Spring ${year}`);
  return out;
}

/**
 * A cleared plan keeps the degree's shape: every semester lists the requirements the catalog
 * plans there, as placeholders to pick courses for. Courses already earned as credit are left out.
 */
function clearedTerms(program: Program, courses: Course[], state: PlanState): Term[] {
  const credit = state.terms.find((t) => t.kind === "credit");
  const earned = new Set(credit?.items.flatMap((i) => (i.kind === "course" ? [i.code] : [])) ?? []);
  const suggested = program.suggestedPlan.map((t) => ({
    ...t,
    items: t.items.filter((i) => i.kind !== "course" || !earned.has(i.code)),
  }));
  const map = new Map([...courses, ...state.extraCourses].map((c) => [c.code, c]));
  return requirementSkeleton(program, map, suggested);
}

export function Planner({ program, courses, school, year, schoolName, mode = "edit", shared }: Props) {
  const viewOnly = mode === "view";
  const key = storageKey(school, year, program.id);
  const router = useRouter();
  const pathname = usePathname();

  // The server renders the catalog's suggested plan (fast first paint, no layout jump).
  // After hydration, a saved plan or the picker's ?start= choice replaces it (see the effect below).
  const [state, dispatch] = useReducer(
    reducer,
    viewOnly && shared ? shared : { terms: program.suggestedPlan, extraCourses: [] },
  );
  const ref = useMemo(() => ({ school, year, programId: program.id }), [school, year, program.id]);
  const suggestedState = useMemo(() => ({ terms: program.suggestedPlan, extraCourses: [] }), [program]);
  const sync = usePlanSync({ ref, storageKey: key, state, dispatch, suggested: suggestedState, disabled: viewOnly });
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoverRule, setHoverRule] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [dragging, setDragging] = useState<PlanItem | null>(null);
  const [dragAt, setDragAt] = useState<{ point: { x: number; y: number } | null; over: string | null }>({ point: null, over: null });
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const reqDialog = useRef<HTMLDialogElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // One toast at a time. Destructive actions happen at once and offer Undo instead of asking first.
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flash = useCallback((msg: string, undo?: () => void) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, undo });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 8000 : 3500);
  }, []);
  const undoable = useCallback(
    (msg: string, before: PlanState) =>
      flash(msg, () => {
        dispatch({ type: "load", state: before });
        flash("Restored.");
      }),
    [flash],
  );

  // After hydration: apply ?start= from the picker, else restore the plan saved in this browser.
  const restored = useRef(false);
  const startedFresh = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (viewOnly) {
      track("shared_opened", { school, programId: program.id });
      return;
    }
    trackPlanOpened(school, program.id);
    const start = new URLSearchParams(window.location.search).get("start");
    if (start === "empty" || start === "suggested") {
      startedFresh.current = true;
      // A fresh start: no credit entered yet.
      if (start === "empty") dispatch({ type: "reset", terms: clearedTerms(program, courses, { terms: [], extraCourses: [] }) });
      router.replace(pathname, { scroll: false });
      return;
    }
    const saved = loadSaved(key);
    if (saved)
      dispatch({
        type: "load",
        state: { terms: saved.terms, extraCourses: saved.extraCourses, startTerm: saved.startTerm ?? null },
      });
    // Arrived from "Copy into my plan" over an existing plan: offer to bring the old one back.
    const replaced = takeReplaced(key);
    if (replaced) {
      // After this render settles (a toast isn't part of restoring the plan).
      setTimeout(() => flash("Replaced your saved plan with the shared one.", () => {
        restoreReplaced(key, replaced);
        const old = loadSaved(key);
        if (old)
          dispatch({
            type: "load",
            state: { terms: old.terms, extraCourses: old.extraCourses, startTerm: old.startTerm ?? null },
          });
        flash("Restored your previous plan.");
      }));
    }
  }, [viewOnly, key, router, pathname, school, program, courses, flash]);

  // Save after every change (debounced). The restore itself isn't a change, except a ?start= choice,
  // which replaces whatever was saved before.
  const saves = useRef(0);
  const edited = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (viewOnly) return;
    if (saves.current++ === 0 && !startedFresh.current) return;
    if (!edited.current && !startedFresh.current) {
      edited.current = true;
      track("plan_edited", { school, programId: program.id });
    }
    const flush = () => {
      pending.current = null;
      save(key, state, sync.activeId);
      setSavedAt(new Date().toISOString());
    };
    pending.current = flush;
    const t = setTimeout(flush, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only plan changes should trigger a save
  }, [state, key]);

  // Count prints / PDF saves (menu button or Ctrl+P alike).
  useEffect(() => {
    const onPrint = () => track("pdf_printed", { school, programId: program.id });
    window.addEventListener("beforeprint", onPrint);
    return () => window.removeEventListener("beforeprint", onPrint);
  }, [school, program.id]);

  // Don't lose an edit made just before a reload, tab close or app switch.
  useEffect(() => {
    const onHide = () => pending.current?.();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  const courseMap = useMemo(
    () => new Map([...courses, ...state.extraCourses].map((c) => [c.code, c])),
    [courses, state.extraCourses],
  );
  const ev = useMemo(() => evaluate(program, courseMap, state.terms), [program, courseMap, state.terms]);
  const today = useToday();
  const calendar = useMemo(
    () => termCalendar(state.terms, state.startTerm, today ? new Date(`${today}T12:00:00`) : null),
    [state.terms, state.startTerm, today],
  );
  const changeableFrom = useMemo(() => firstChangeableIndex(state.terms, calendar), [state.terms, calendar]);
  const schedule = useMemo(
    () => analyzeSchedule(state.terms, courseMap, { changeableFrom }),
    [state.terms, courseMap, changeableFrom],
  );
  const edges = schedule.edges;
  const delayByItem = new Map(schedule.delays.map((d) => [d.itemId, d]));
  const gradTerm = state.terms[schedule.lastTerm];
  const longest = schedule.longestChain;
  const answer = useMemo(
    () =>
      answerFor({
        ev,
        delays: schedule.delays,
        finish: gradTerm ? (calendar.get(gradTerm.id)?.realLabel ?? gradTerm.label) : null,
        itemCount: state.terms.reduce((n, t) => n + (t.kind === "credit" ? 0 : t.items.length), 0),
      }),
    [ev, schedule.delays, gradTerm, calendar, state.terms],
  );
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
        const after = evaluate(program, map, terms);
        // Prerequisites the plan doesn't have before this semester: not a recommendation yet.
        const needs = after.prereqIssues.find((i) => i.itemId === "__preview")?.missing ?? [];
        return { gains: improvements(ev, after), needs };
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
  // Track the lifted stop so its prerequisite tracks follow it live.
  const onDragMove = (e: DragMoveEvent) => {
    const r = e.active.rect.current.translated;
    const point = r ? { x: r.left + 7, y: r.top + 10 } : null;
    const over = e.over ? String(e.over.id) : null;
    setDragAt((d) => (d.over === over && d.point?.x === point?.x && d.point?.y === point?.y ? d : { point, over }));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    setDragAt({ point: null, over: null });
    if (e.over && e.over.id !== e.active.data.current?.termId) {
      dispatch({ type: "move", itemId: String(e.active.id), toTermId: String(e.over.id) });
    }
  };

  const pick = useCallback(
    (course: Course) => {
      if (!dialog) return;
      dispatch(
        dialog.mode === "add"
          ? { type: "add", termId: dialog.id, course }
          : dialog.mode === "credit"
            ? { type: "addCredit", course }
            : { type: "fill", slotId: dialog.id, course },
      );
      setDialog(null);
    },
    [dialog],
  );

  const reset = (to: "suggested" | "empty") => {
    const before = state;
    setSelected(null);
    dispatch({ type: "reset", terms: to === "suggested" ? program.suggestedPlan : clearedTerms(program, courses, state) });
    undoable(
      to === "suggested" ? "Started over from the suggested plan." : "Cleared your courses — each semester shows what it needs.",
      before,
    );
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);


  const share = async () => {
    const url = `${window.location.origin}/share/${school}/${year}/${program.id}#p=${await encodePlan(state.terms, state.startTerm)}`;
    track("share_created", { school, programId: program.id });
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
    keepReplaced(key);
    save(key, state, null);
    router.push(`/plan/${school}/${year}/${program.id}`);
  };


  const hasCredit = state.terms.some((t) => t.kind === "credit");
  // Show an empty credit column to edit, unless viewing someone else's plan.
  const shownTerms = useMemo(
    () =>
      hasCredit || viewOnly
        ? state.terms
        : [{ id: CREDIT_TERM_ID, label: CREDIT_LABEL, kind: "credit" as const, items: [] }, ...state.terms],
    [hasCredit, viewOnly, state.terms],
  );
  const checked = ev.areas.filter((a) => a.result.status !== "manual");
  const metCount = checked.filter((a) => a.result.status === "met").length;
  const issueCount = ev.prereqIssues.length;
  // Big routes (a first math course can lead to half the degree) get tangled: past a dozen
  // tracks, draw only the selected course's direct links and its longest chain onward.
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
  // Tracks that run backwards: a prerequisite planned after (or alongside) the course that needs it.
  // Drawn only for the selected course's route: every stop with a problem already says so in text,
  // and several red diagonals at once cross the board's labels.
  const badEdges = useMemo(() => {
    if (!route || !selected) return [];
    const onRoute = new Set(route.edges.map((e) => `${e.from}>${e.to}`));
    return edges.filter(
      (e) => issues.has(e.to) && (e.from === selected || e.to === selected || onRoute.has(`${e.from}>${e.to}`)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- issues is derived from ev
  }, [edges, ev, route, selected]);

  const removeItem = (item: PlanItem) => {
    const before = state;
    dispatch({ type: "remove", itemId: item.id });
    setSelected(null);
    undoable(
      item.kind === "course" ? `Removed ${item.code}${item.placeholder ? " — its placeholder is back" : ""}.` : `Removed ${item.label}.`,
      before,
    );
  };
  const routeSummaryFor = (id: string) =>
    selected === id && route
      ? {
          needs: [...route.upstream].map((x) => itemCode.get(x) ?? ""),
          unlocks: [...route.downstream].map((x) => itemCode.get(x) ?? ""),
          slack: schedule.items.get(id)?.slack ?? 0,
        }
      : undefined;
  const selectedTerm = selected ? state.terms.find((t) => t.items.some((i) => i.id === selected)) : undefined;
  const selectedItem = selectedTerm?.items.find((i) => i.id === selected);

  const lines = useMemo(() => linesFor(program), [program]);
  const lineOf = useMemo(() => lineAssignments(lines, ev), [lines, ev]);
  const itemById = useMemo(() => new Map(shownTerms.flatMap((t) => t.items.map((i) => [i.id, i] as const))), [shownTerms]);
  const termName = (t: { id: string; label: string }) => calendar.get(t.id)?.realLabel ?? t.label;

  // The departure board: when you arrive, how many hours are on board, and the service status.
  const finishLabel = gradTerm ? termName(gradTerm) : null;
  const board = [
    { key: "ARRIVING", value: finishLabel ? boardTerm(finishLabel) : "—", hot: schedule.delays.length > 0 },
    { key: "ON BOARD", value: `${ev.totalCredits}/${program.totalHours} HRS` },
    { key: "STATUS", value: statusWord(answer, schedule.delays.length, issueCount), hot: answer.tone === "attention" },
  ];

  const openRequirements = (areaId?: string) => {
    reqDialog.current?.showModal();
    if (areaId) requestAnimationFrame(() => document.getElementById(`area-${areaId}`)?.scrollIntoView({ block: "start" }));
  };

  const panel = (
    <RequirementsPanel areas={ev.areas} fresh={fresh} onHover={setHoverRule} notes={program.reviewNotes} lines={lines} />
  );

  return (
    <div className="pb-28 sm:pb-12 print:pb-0" data-ready={today ? "true" : undefined}>
      <header className="border-b-[3px] border-ink">
        <div className="mx-auto max-w-[1600px] px-4 pt-3 sm:px-6">
          {/* Where am I (small) and the plan's actions. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <nav aria-label="You are here" className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-body-sm">
              <Link href="/" className="wordmark text-title-sm">
                Plotted
              </Link>
              <span aria-hidden className="text-ink-soft">/</span>
              <span className="text-ink-soft">{schoolName}</span>
              <span aria-hidden className="text-ink-soft">/</span>
              <h1 className="font-sans text-body-sm font-semibold">
                {program.name} <span className="font-normal text-ink-soft">· {program.degree}</span>
              </h1>
              <span className="font-mono text-caption text-ink-soft">{program.catalogYear} catalog</span>
            </nav>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              {viewOnly && (
                <>
                  <button type="button" onClick={copyToMine} className="btn btn-primary text-body-sm">
                    Copy into my plan
                  </button>
                  <button type="button" onClick={() => window.print()} className="btn text-body-sm">
                    Print / PDF
                  </button>
                </>
              )}
              {/* Space for the sign-in button is reserved from the first (server) render so the
                  header doesn't shift when the account check finishes after hydration. */}
              {!viewOnly && ACCOUNTS_CONFIGURED && !sync.user && (
                <button
                  type="button"
                  disabled={sync.status !== "signed-out"}
                  aria-hidden={sync.status !== "signed-out"}
                  tabIndex={sync.status === "signed-out" ? 0 : -1}
                  onClick={async () => {
                    const err = await signInWithGoogle();
                    if (err) window.alert(`Sign-in isn't working yet: ${err}`);
                  }}
                  className={`btn text-body-sm ${sync.status === "signed-out" ? "" : "invisible"}`}
                >
                  Sign in to sync
                </button>
              )}
              <details className={`relative ${viewOnly ? "hidden" : ""}`}>
                <summary className="btn cursor-pointer list-none text-body-sm">
                  {sync.user ? (sync.plans.find((p) => p.id === sync.activeId)?.name ?? "Plan") : "Plan"} ▾
                </summary>
                <div className="menu absolute right-0 z-40 mt-2 w-64 p-1.5 text-body-sm">
                  {sync.user && sync.plans.length > 0 && (
                    <fieldset className="mb-1.5 border-b border-rule pb-1.5">
                      <legend className="px-2 pt-1 font-mono text-label text-ink-soft uppercase">Your plans</legend>
                      {sync.plans.map((p) => (
                        <label key={p.id} className="menu-item flex cursor-pointer items-center gap-2">
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
                      <button type="button" onClick={() => sync.newPlan("copy")} className="menu-item">
                        ＋ Save a copy as a new plan
                      </button>
                      <button type="button" onClick={sync.rename} className="menu-item">
                        Rename this plan
                      </button>
                      {sync.plans.length > 1 && (
                        <button type="button" onClick={sync.remove} className="menu-item text-alert-text">
                          Delete this plan
                        </button>
                      )}
                    </fieldset>
                  )}
                  <button type="button" onClick={share} className="menu-item font-semibold">
                    Share a read-only link
                  </button>
                  <button type="button" onClick={() => window.print()} className="menu-item">
                    Print / Save as PDF
                  </button>
                  <div className="my-1.5 border-t border-rule" />
                  <button type="button" onClick={() => reset("suggested")} className="menu-item">
                    Reset to suggested plan
                  </button>
                  <button type="button" onClick={() => reset("empty")} className="menu-item">
                    Clear my courses
                  </button>
                  <a href={program.sourceUrl} target="_blank" rel="noreferrer" className="menu-item">
                    Open the catalog page ↗
                  </a>
                  {sync.user && (
                    <>
                      <div className="my-1.5 border-t border-rule" />
                      <button type="button" onClick={sync.signOut} className="menu-item">
                        Sign out <span className="block truncate text-caption text-ink-soft">{sync.user.email}</span>
                      </button>
                    </>
                  )}
                </div>
              </details>
            </div>
          </div>

          {/* The answer: the departure board, then the sentence behind it. */}
          <section aria-label="Where your plan stands" className="mt-5 flex flex-col gap-4 pb-5 md:flex-row md:items-center md:gap-8">
            <FlapBoard rows={board} summary={`${answer.headline}. ${answer.detail}`} />
            <div className="min-w-0">
              <p
                aria-live="polite"
                className={`font-display text-headline font-extrabold ${answer.tone === "attention" ? "text-alert-text" : ""}`}
              >
                {answer.headline}
              </p>
              <p className="mt-2 max-w-[70ch] text-body text-ink-soft">
                {answer.detail}{" "}
                {answer.focusItemId && (
                  <button
                    type="button"
                    onClick={() => setSelected(answer.focusItemId!)}
                    className="font-semibold text-ink underline underline-offset-2 print:hidden"
                  >
                    Show the route
                  </button>
                )}
                {!answer.focusItemId && answer.open.length > 0 && (
                  <button
                    type="button"
                    onClick={() => openRequirements()}
                    className="font-semibold text-ink underline underline-offset-2 print:hidden"
                  >
                    See what&apos;s open
                  </button>
                )}
              </p>
              <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-body-sm">
                <div className="flex items-center gap-2">
                  <dt className="font-semibold">Started</dt>
                  <dd>
                    {viewOnly ? (
                      state.startTerm && <span className="text-ink-soft">{state.startTerm}</span>
                    ) : (
                      <label className="flex items-center gap-2">
                        <span className="sr-only">Started</span>
                        <select
                          disabled={!today}
                          value={state.startTerm ?? ""}
                          onChange={(e) => dispatch({ type: "setStartTerm", startTerm: e.target.value || null })}
                          className="rounded-full border-[1.5px] border-ink bg-card px-2 py-0.5 font-mono text-caption"
                        >
                          <option value="">Not set yet</option>
                          {startTermOptions(today).map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </dd>
                </div>
                {longest.length > 1 && (
                  <div className="flex items-center gap-2">
                    <dt className="font-semibold">Longest chain</dt>
                    <dd>
                      <button type="button" onClick={() => setSelected(longest[0]!)} className="font-mono underline underline-offset-2">
                        {longest.length} courses
                      </button>
                    </dd>
                  </div>
                )}
              </dl>
              {!viewOnly && !state.startTerm && (
                <p className="mt-1.5 text-caption text-ink-soft">
                  Set when you started to see real semester names and what&apos;s already done.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* Service status: one entry per line. Hover lights its stops; click opens the details. */}
        <nav aria-label="Requirements by line" className="border-t border-rule print:hidden">
          <ul className="strip-scroll mx-auto flex max-w-[1600px] gap-x-1 overflow-x-auto px-2 py-1.5 sm:px-4">
            {ev.areas.map((a) => {
              const line = lines.find((l) => l.id === a.id);
              const s = STATUS[a.result.status];
              return (
                <li key={a.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => openRequirements(a.id)}
                    onMouseEnter={() => setHoverRule(a.result.id)}
                    onMouseLeave={() => setHoverRule(null)}
                    onFocus={() => setHoverRule(a.result.id)}
                    onBlur={() => setHoverRule(null)}
                    className="flex items-center gap-2 rounded-chip px-2 py-1.5 text-left hover:bg-paper-2"
                  >
                    <span
                      className="bullet"
                      data-size="sm"
                      style={{ ["--c" as string]: line?.color ?? "var(--ink)", ["--on" as string]: line?.on ?? "var(--paper)" }}
                      aria-hidden
                    >
                      {line?.mark ?? "Σ"}
                    </span>
                    <span className="text-body-sm leading-tight font-semibold">{a.label.replace(/\s*\(.*\)\s*$/, "")}</span>
                    <span className={`text-caption font-bold whitespace-nowrap ${s.cls}`}>
                      <span aria-hidden>{s.glyph} </span>
                      {s.word}
                      {a.result.hours ? (
                        <span className="font-mono font-normal text-ink-soft">
                          {" "}
                          {a.result.hours.planned}/{a.result.hours.required}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <p className="mx-auto max-w-[1600px] border-t border-rule px-4 py-1.5 text-caption text-ink-soft sm:px-6">
          Not an official degree audit. Confirm with your advisor.{" "}
          <Link href="/about" className="font-semibold text-ink underline underline-offset-2 print:hidden">
            What&apos;s checked?
          </Link>{" "}
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
        <div
          role="status"
          className="fixed inset-x-0 top-3 z-50 mx-auto flex w-fit max-w-[calc(100vw-24px)] items-center gap-3 rounded-full bg-ink px-4 py-2 text-body-sm font-semibold text-paper shadow-lg print:hidden"
        >
          {toast.msg}
          {toast.undo && (
            <button type="button" onClick={toast.undo} className="text-focus underline decoration-2 underline-offset-2">
              Undo
            </button>
          )}
        </div>
      )}
      {sync.notice && (
        <div role="status" className="border-b border-ink bg-focus text-on-focus">
          <p className="mx-auto flex max-w-[1600px] items-start justify-between gap-3 px-4 py-2 text-body-sm">
            <span>{sync.notice}</span>
            <button type="button" onClick={sync.dismissNotice} className="font-semibold underline">
              OK
            </button>
          </p>
        </div>
      )}

      <div className="mx-auto max-w-[1600px] pt-2 print:pt-1">
        {selected && (
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-body-sm sm:px-6 print:hidden">
            <span className="font-semibold">Route for {itemCode.get(selected)}</span>
            <span className="text-ink-soft">Black track = prerequisite; dashed red runs backwards.</span>
            <button type="button" onClick={() => setSelected(null)} className="font-medium underline underline-offset-2">
              Clear
            </button>
          </p>
        )}
        <h2 className="sr-only">Semesters</h2>
        <DndContext
          id="plotted-planner"
          sensors={sensors}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragEnd={onDragEnd}
          onDragCancel={() => {
            setDragging(null);
            setDragAt({ point: null, over: null });
          }}
        >
          <div ref={gridRef} onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
            <Diagram
              terms={shownTerms}
              lines={lines}
              lineOf={lineOf}
              termMeta={(t) => termMeta(t, calendar.get(t.id), ev.termCredits[t.id] ?? 0)}
              renderHead={(t) => <TermHead term={t} info={calendar.get(t.id)} credits={ev.termCredits[t.id] ?? 0} />}
              renderFoot={(term) => {
                const ti = shownTerms.indexOf(term);
                const isCredit = term.kind === "credit";
                const hasSummerAfter = shownTerms[ti + 1]?.label.endsWith("Summer");
                return (
                  <TermFoot
                    term={term}
                    onAddCourse={
                      viewOnly
                        ? undefined
                        : isCredit
                          ? () => setDialog({ mode: "credit", id: CREDIT_TERM_ID, title: "Add a course you already have credit for" })
                          : () => setDialog({ mode: "add", id: term.id, title: `Add to ${termName(term)}`, ...suggest("add", term.id) })
                    }
                    onRemoveTerm={
                      !viewOnly && !isCredit && state.terms.length > 1 ? () => dispatch({ type: "removeTerm", termId: term.id }) : undefined
                    }
                    onAddSummer={
                      !viewOnly && term.label.endsWith("Spring") && !hasSummerAfter
                        ? () => dispatch({ type: "addTerm", season: "Summer", afterTermId: term.id })
                        : undefined
                    }
                  />
                );
              }}
              renderStop={(itemId, term, line, laneIndex) => {
                const item = itemById.get(itemId)!;
                return (
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
                    color={line.color}
                    laneIndex={laneIndex}
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
                    onMove={(to) => dispatch({ type: "move", itemId: item.id, toTermId: to })}
                    onRemove={() => removeItem(item)}
                    routeSummary={routeSummaryFor(item.id)}
                  />
                );
              }}
              addColumn={
                viewOnly ? undefined : (
                  <div className="flex h-full items-start justify-center pt-3 print:hidden">
                    <button type="button" onClick={() => dispatch({ type: "addTerm", season: "Fall" })} className="btn text-body-sm">
                      ＋ Add semester
                    </button>
                  </div>
                )
              }
              routeEdges={drawnEdges}
              badEdges={badEdges}
              allEdges={edges}
              drag={dragging ? { itemId: dragging.id, point: dragAt.point, overTermId: dragAt.over } : null}
              layoutKey={String(selected)}
            />
          </div>
          {selectedItem?.kind === "course" && selectedTerm && (
            <StopCard
              item={selectedItem}
              terms={state.terms}
              termId={selectedTerm.id}
              readOnly={viewOnly}
              onMove={(to) => dispatch({ type: "move", itemId: selectedItem.id, toTermId: to })}
              onRemove={() => removeItem(selectedItem)}
              routeSummary={routeSummaryFor(selectedItem.id)}
              onClose={() => setSelected(null)}
            />
          )}
          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}>
            {dragging && (
              <div
                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink bg-card py-1.5 pr-3 pl-2 shadow-lg"
                style={{ ["--c" as string]: lineOf.get(dragging.id)?.color ?? "var(--ink)" }}
              >
                <span className="stop-dot" style={{ margin: 0 }} aria-hidden />
                <span className={dragging.kind === "slot" ? "slot-label text-body-sm" : "font-mono text-body-sm font-bold"}>
                  {dragging.kind === "course" ? dragging.code : dragging.label}
                </span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
        <div className="px-4 sm:px-6">
          <PrintSummary program={program} ev={ev} delays={schedule.delays} schoolName={schoolName} />
        </div>
      </div>

      {/* Phone: requirements in reach of the thumb. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t-[1.5px] border-ink bg-paper px-4 py-3 sm:hidden print:hidden">
        <button
          type="button"
          onClick={() => openRequirements()}
          className="flex w-full items-center justify-between gap-3 rounded-full border-[1.5px] border-ink bg-card px-4 py-2"
        >
          <span className="font-bold">Requirements</span>
          <span className="flex items-center gap-2 font-mono text-caption">
            {metCount}/{checked.length} met
            {issueCount > 0 && <span className="font-bold text-alert-text">✕ {issueCount} prereq</span>}
            <StatusMark status={metCount === checked.length ? "met" : "partial"} />
          </span>
        </button>
      </div>
      <dialog
        ref={reqDialog}
        aria-label="Requirements"
        onClick={(e) => e.target === reqDialog.current && reqDialog.current?.close()}
        className="sheet mt-auto mb-0 max-h-[85dvh] w-full max-w-none rounded-t-card sm:mt-0 sm:mr-0 sm:mb-0 sm:ml-auto sm:h-dvh sm:max-h-none sm:w-[420px] sm:rounded-none sm:border-y-0 sm:border-r-0"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b-[1.5px] border-ink bg-paper px-4 py-3">
          <h2 className="text-title-sm font-extrabold">
            Requirements{" "}
            <span className="font-mono text-caption font-normal text-ink-soft">
              {metCount}/{checked.length} areas met
            </span>
          </h2>
          <button type="button" onClick={() => reqDialog.current?.close()} className="btn px-2.5 py-0.5" aria-label="Close requirements">
            ✕
          </button>
        </div>
        <div className="px-4 pb-6">{panel}</div>
      </dialog>

      <CourseDialog target={dialog} school={school} year={year} planned={planned} onPick={pick} onClose={() => setDialog(null)} />
    </div>
  );
}
