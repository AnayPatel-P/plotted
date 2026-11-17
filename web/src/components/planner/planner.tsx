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
import { type AnswerTone, answerFor } from "@/lib/answer";
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
  shared?: { terms: Term[]; extraCourses: Course[]; startTerm?: string | null };
}

function walkRules(r: RuleResult, fn: (r: RuleResult) => void) {
  fn(r);
  r.children?.forEach((c) => walkRules(c, fn));
}

/** Inlined at build time, so the server and browser agree on it. */
const ACCOUNTS_CONFIGURED = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const ANSWER_INK: Record<AnswerTone, string> = {
  attention: "text-pink-text",
  planned: "text-violet-text",
  done: "text-blue-text",
  empty: "text-ink-soft",
};

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

const yearOf = (label: string) => Number(label.match(/Year (\d+)/)?.[1] ?? 0);

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
  const [mobileYear, setMobileYear] = useState(1);
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
  // Stamp the answer glyph when the tone improves (e.g. the last open requirement gets met).
  const prevTone = useRef(answer.tone);
  const [answerFresh, setAnswerFresh] = useState(false);
  useEffect(() => {
    const rank: Record<AnswerTone, number> = { empty: 0, attention: 1, planned: 2, done: 3 };
    if (rank[answer.tone] > rank[prevTone.current]) {
      setAnswerFresh(true);
      const t = setTimeout(() => setAnswerFresh(false), 400);
      prevTone.current = answer.tone;
      return () => clearTimeout(t);
    }
    prevTone.current = answer.tone;
  }, [answer.tone]);
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
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
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

  const years = [...new Set(state.terms.filter((t) => t.kind !== "credit").map((t) => yearOf(t.label)))];
  const hasCredit = state.terms.some((t) => t.kind === "credit");
  // Show an empty credit column to edit, unless viewing someone else's plan.
  const shownTerms = hasCredit || viewOnly
    ? state.terms
    : [{ id: CREDIT_TERM_ID, label: CREDIT_LABEL, kind: "credit" as const, items: [] }, ...state.terms];
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
    <div className="pb-28 lg:pb-10 print:pb-0" data-ready={today ? "true" : undefined}>
      {/* Masthead: where am I (small) → the answer (largest) → details (small). */}
      <header className="border-b-2 border-ink">
        <div className="mx-auto max-w-[1500px] px-4 pt-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <nav aria-label="You are here" className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-body-sm">
              <Link href="/" className="riso-title text-title-sm font-extrabold" style={{ fontVariationSettings: '"wdth" 80' }}>
                PLOTTED
              </Link>
              <span aria-hidden className="text-ink-soft">/</span>
              <span className="text-ink-soft">{schoolName}</span>
              <span aria-hidden className="text-ink-soft">/</span>
              <h1 className="text-body-sm font-semibold">
                {program.name} <span className="font-normal text-ink-soft">· {program.degree}</span>
              </h1>
              <span className="font-mono text-caption text-ink-soft">{program.catalogYear} catalog</span>
            </nav>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
            {viewOnly && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={copyToMine}
                    className="rounded-full border-2 border-ink bg-yellow px-3 py-1 text-body-sm font-bold text-on-yellow shadow-[2px_2px_0_0_var(--shadow-ink)] hover:-translate-y-px"
                  >
                    Copy into my plan
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="rounded-full border-2 border-ink px-3 py-1 text-body-sm font-semibold hover:bg-yellow hover:text-on-yellow"
                  >
                    Print / PDF
                  </button>
                </div>
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
                  className={`rounded-full border-2 border-ink bg-card px-3 py-1 text-body-sm font-semibold shadow-[2px_2px_0_0_var(--shadow-ink)] hover:-translate-y-px ${
                    sync.status === "signed-out" ? "" : "invisible"
                  }`}
                >
                  Sign in to sync
                </button>
              )}
            <details className={`relative ${viewOnly ? "hidden" : ""}`}>
                <summary className="cursor-pointer list-none rounded-full border-2 border-ink px-3 py-1 text-body-sm font-semibold hover:bg-yellow hover:text-on-yellow">
                  {sync.user ? (sync.plans.find((p) => p.id === sync.activeId)?.name ?? "Plan") : "Plan"} ▾
                </summary>
                <div className="absolute right-0 z-40 mt-2 w-64 rounded-chip border-2 border-ink bg-card p-2 text-body-sm shadow-[4px_4px_0_0_var(--shadow-ink)]">
                  {sync.user && sync.plans.length > 0 && (
                    <fieldset className="mb-2 border-b-2 border-dashed border-rule pb-2">
                      <legend className="px-2 font-mono text-label text-ink-soft uppercase">Your plans</legend>
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
                    Clear my courses
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
                      Sign out <span className="block truncate text-label text-ink-soft">{sync.user.email}</span>
                    </button>
                  )}
                </div>
              </details>
            </div>
          </div>

          {/* The answer: am I on track to graduate? */}
          <section aria-label="Where your plan stands" className="mt-4 flex items-start gap-3">
            <span
              aria-hidden
              className={`stamp mt-1 shrink-0 text-title-sm ${ANSWER_INK[answer.tone]}`}
              data-fresh={answerFresh}
            >
              {answer.glyph}
            </span>
            <div className="min-w-0">
              <p aria-live="polite" className={`font-display text-headline font-extrabold ${answer.tone === "attention" ? "text-pink-text" : ""}`}>
                {answer.headline}
              </p>
              <p className="mt-1 max-w-[70ch] text-body text-ink-soft">
                {answer.detail}{" "}
                {answer.focusItemId && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = answer.focusItemId!;
                      setSelected(id);
                      const t = state.terms.find((x) => x.items.some((i) => i.id === id));
                      if (t) setMobileYear(t.kind === "credit" ? 1 : yearOf(t.label));
                    }}
                    className="font-semibold text-blue-text underline print:hidden"
                  >
                    Show the route
                  </button>
                )}
                {!answer.focusItemId && answer.open.length > 0 && (
                  <button
                    type="button"
                    onClick={() => reqDialog.current?.showModal()}
                    className="font-semibold text-blue-text underline lg:hidden print:hidden"
                  >
                    See what&apos;s open
                  </button>
                )}
              </p>
            </div>
          </section>

          {/* Details, in reading order. */}
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
                      className="rounded-full border-2 border-ink bg-card px-2 py-0.5 font-mono text-caption"
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
            {gradTerm && (
              <div className="flex items-center gap-2">
                <dt className="font-semibold">Last semester</dt>
                <dd className={schedule.delays.length ? "font-semibold text-pink-text" : ""}>
                  {calendar.get(gradTerm.id)?.realLabel ?? gradTerm.label}
                </dd>
              </div>
            )}
            <div className="flex items-center gap-2">
              <dt className="font-semibold">Hours</dt>
              <dd className="font-mono tabular-nums">
                {ev.totalCredits}
                <span className="text-ink-soft">/{program.totalHours}</span>
              </dd>
            </div>
            {longest.length > 1 && (
              <div className="flex items-center gap-2">
                <dt className="font-semibold">Longest chain</dt>
                <dd>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(longest[0]!);
                      setMobileYear(yearOf(state.terms[schedule.items.get(longest[0]!)!.termIndex]!.label));
                    }}
                    className="font-mono text-blue-text underline"
                  >
                    {longest.length} courses
                  </button>
                </dd>
              </div>
            )}
            {!viewOnly && !state.startTerm && (
              <p className="basis-full text-caption text-ink-soft sm:basis-auto">
                Set when you started to see real semester names and what&apos;s already done.
              </p>
            )}
          </dl>
        </div>
        <p className="mx-auto max-w-[1500px] px-4 pb-2 text-caption text-ink-soft">
          Not an official degree audit. Confirm with your advisor.{" "}
          <Link href="/about" className="font-semibold text-blue-text underline print:hidden">
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
        <div role="status" className="fixed inset-x-0 top-3 z-50 mx-auto w-fit max-w-[calc(100vw-24px)] rounded-full border-2 border-ink bg-card px-4 py-2 text-body-sm font-semibold shadow-[3px_3px_0_0_var(--shadow-ink)] print:hidden">
          {toast.msg}
          {toast.undo && (
            <button type="button" onClick={toast.undo} className="ml-3 underline decoration-2 underline-offset-2">
              Undo
            </button>
          )}
        </div>
      )}
      {sync.notice && (
        <div role="status" className="border-b-2 border-ink bg-yellow text-on-yellow">
          <p className="mx-auto flex max-w-[1500px] items-start justify-between gap-3 px-4 py-2 text-body-sm">
            <span>{sync.notice}</span>
            <button type="button" onClick={sync.dismissNotice} className="font-semibold underline">
              OK
            </button>
          </p>
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
            className={`shrink-0 rounded-full border-2 border-ink px-4 py-1 font-mono text-body-sm font-medium ${
              mobileYear === y ? "bg-ink text-paper" : "bg-card"
            }`}
          >
            Year {y}
          </button>
        ))}
      </nav>

      <div className="mx-auto grid max-w-[1500px] gap-6 px-4 pt-5 lg:grid-cols-[minmax(0,1fr)_360px] print:block print:px-0 print:pt-2">
        <DndContext id="plotted-planner" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <div ref={gridRef} className="relative" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
            {selected && (
              <p className="mb-3 flex print:hidden flex-wrap items-center gap-x-4 gap-y-1 text-body-sm">
                <span className="font-semibold">Route for {itemCode.get(selected)}</span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-1 w-6 rounded bg-blue" /> builds on
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-1 w-6 rounded bg-violet" /> leads to
                </span>
                <button type="button" onClick={() => setSelected(null)} className="font-medium text-blue-text underline">
                  Clear
                </button>
              </p>
            )}
            <h2 className="sr-only">Semesters</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fill,minmax(228px,1fr))] print:grid-cols-4 print:gap-2">
              {shownTerms.map((term, ti) => {
                const next = shownTerms[ti + 1];
                const isCredit = term.kind === "credit";
                const isSpring = term.label.endsWith("Spring");
                const hasSummerAfter = next?.label.endsWith("Summer");
                return (
                  <div
                    key={term.id}
                    className={`${(isCredit ? 1 : yearOf(term.label)) === mobileYear ? "" : "max-sm:hidden print:block"} ${
                      isCredit && !term.items.length ? "print:hidden" : ""
                    }`}
                  >
                    <TermCard
                      term={term}
                      info={calendar.get(term.id)}
                      credits={ev.termCredits[term.id] ?? 0}
                      onAddCourse={
                        viewOnly
                          ? undefined
                          : isCredit
                            ? () => setDialog({ mode: "credit", id: CREDIT_TERM_ID, title: "Add a course you already have credit for" })
                            : () =>
                                setDialog({
                                  mode: "add",
                                  id: term.id,
                                  title: `Add to ${calendar.get(term.id)?.realLabel ?? term.label}`,
                                  ...suggest("add", term.id),
                                })
                      }
                      onRemoveTerm={
                        !viewOnly && !isCredit && state.terms.length > 1
                          ? () => dispatch({ type: "removeTerm", termId: term.id })
                          : undefined
                      }
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
                            const before = state;
                            dispatch({ type: "remove", itemId: item.id });
                            setSelected(null);
                            undoable(
                              item.kind === "course"
                                ? `Removed ${item.code}${item.placeholder ? " — its placeholder is back" : ""}.`
                                : `Removed ${item.label}.`,
                              before,
                            );
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
                  className="rounded-full border-2 border-ink bg-card px-4 py-2 font-semibold shadow-[3px_3px_0_0_var(--shadow-ink)] hover:-translate-y-px"
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
                <span className="font-mono text-body-sm font-medium">{dragging.kind === "course" ? dragging.code : dragging.label}</span>
                {dragging.kind === "course" && (
                  <span className="block text-caption text-ink-soft">{courseMap.get(dragging.code)?.title}</span>
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>

        <aside aria-label="Requirements" className="hidden lg:block print:hidden">
          <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto pr-1 pb-4">
            <h2 className="mb-3 flex items-baseline justify-between">
              <span className="text-title-sm font-extrabold">Requirements</span>
              <span className="font-mono text-caption text-ink-soft">
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
          className="flex w-full items-center justify-between gap-3 rounded-full border-2 border-ink bg-card px-4 py-2 shadow-[3px_3px_0_0_var(--shadow-ink)]"
        >
          <span className="font-bold">Requirements</span>
          <span className="flex items-center gap-2 font-mono text-caption">
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
          <h2 className="text-title-sm font-extrabold">Requirements</h2>
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
