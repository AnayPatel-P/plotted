"use client";

/**
 * Shared plan model for the redesign prototypes: real engine, real UT CS data.
 * Each variant renders the same live state its own way.
 */
import {
  analyzeSchedule,
  type Course,
  evaluate,
  formatRealTerm,
  type PlanItem,
  type Program,
  realTermFor,
  type RuleResult,
  type Term,
} from "@plotted/engine";
import { useCallback, useMemo, useState } from "react";

const START = { season: "Fall" as const, year: 2026 };

export type LineId = "conc" | "major" | "degree" | "core" | "elective";
export const LINES: { id: LineId; area?: string; name: string; short: string }[] = [
  { id: "conc", area: "concentration", name: "Concentration", short: "CN" },
  { id: "major", area: "major", name: "Major requirements", short: "MJ" },
  { id: "degree", area: "degree", name: "Degree", short: "DG" },
  { id: "core", area: "core", name: "Core curriculum", short: "CC" },
  { id: "elective", name: "Electives", short: "EL" },
];

export interface Stop {
  item: PlanItem;
  termId: string;
  termIndex: number;
  line: LineId;
  code: string; // course code, or "" for placeholders
  label: string; // course title or placeholder label
  credits: number;
  placeholder: boolean;
  issue?: string[]; // missing prerequisites
  critical: boolean;
}

export function usePlan(program: Program, courses: Course[]) {
  const courseMap = useMemo(() => new Map(courses.map((c) => [c.code, c])), [courses]);
  const [terms, setTerms] = useState<Term[]>(() => [
    ...program.suggestedPlan.map((t) => ({ ...t, items: [...t.items] })),
    { id: "y5-fall", label: "Year 5 · Fall", items: [] },
  ]);

  const ev = useMemo(() => evaluate(program, courseMap, terms), [program, courseMap, terms]);
  const sched = useMemo(() => analyzeSchedule(terms, courseMap), [terms, courseMap]);

  // rule id -> area id
  const ruleArea = useMemo(() => {
    const m = new Map<string, string>();
    const walk = (r: RuleResult, area: string) => {
      m.set(r.id, area);
      r.children?.forEach((c) => walk(c, area));
    };
    ev.areas.forEach((a) => walk(a.result, a.id));
    return m;
  }, [ev]);

  const lineOf = useCallback(
    (itemId: string): LineId => {
      const areas = new Set((ev.itemRules[itemId] ?? []).map((r) => ruleArea.get(r)));
      for (const l of LINES) if (l.area && areas.has(l.area)) return l.id;
      return "elective";
    },
    [ev, ruleArea],
  );

  const issues = useMemo(() => new Map(ev.prereqIssues.map((i) => [i.itemId, i.missing])), [ev]);

  const stops: Stop[] = useMemo(
    () =>
      terms.flatMap((t, ti) =>
        t.items.map((item) => {
          const course = item.kind === "course" ? courseMap.get(item.code) : undefined;
          return {
            item,
            termId: t.id,
            termIndex: ti,
            line: lineOf(item.id),
            code: item.kind === "course" ? item.code : "",
            label: item.kind === "course" ? (course?.title ?? "Not in this catalog") : item.label.replace(/\s*\(\d{3}\)/, ""),
            credits: item.kind === "slot" ? item.credits : (course?.credits ?? 3),
            placeholder: item.kind === "slot",
            issue: issues.get(item.id),
            critical: !!sched.items.get(item.id)?.critical,
          };
        }),
      ),
    [terms, courseMap, lineOf, issues, sched],
  );

  const termDate = useCallback((t: Term) => {
    const r = realTermFor(t.label, START);
    return r ? formatRealTerm(r) : t.label;
  }, []);

  const lastIndex = terms.reduce((last, t, i) => (t.items.length ? i : last), -1);
  const finish = lastIndex >= 0 ? termDate(terms[lastIndex]!) : null;

  const open = useMemo(() => {
    const out: RuleResult[] = [];
    const walk = (r: RuleResult) => {
      if (r.status !== "unmet" && r.status !== "partial") return;
      if (!r.children || r.type === "nOf") return void out.push(r);
      const n = out.length;
      r.children.forEach(walk);
      if (out.length === n) out.push(r);
    };
    ev.areas.forEach((a) => walk(a.result));
    return out;
  }, [ev]);

  const move = useCallback((itemId: string, toTermId: string) => {
    setTerms((prev) => {
      const item = prev.flatMap((t) => t.items).find((i) => i.id === itemId);
      if (!item) return prev;
      const from = prev.find((t) => t.items.some((i) => i.id === itemId));
      if (from?.id === toTermId) return prev;
      return prev.map((t) =>
        t.id === toTermId ? { ...t, items: [...t.items, item] } : { ...t, items: t.items.filter((i) => i.id !== itemId) },
      );
    });
  }, []);

  const shift = useCallback(
    (itemId: string, by: number) => {
      const ti = terms.findIndex((t) => t.items.some((i) => i.id === itemId));
      const to = terms[ti + by];
      if (to) move(itemId, to.id);
    },
    [terms, move],
  );

  return {
    terms,
    ev,
    sched,
    stops,
    edges: sched.edges,
    finish,
    open,
    termDate,
    hours: ev.totalCredits,
    totalHours: program.totalHours,
    move,
    shift,
    termCredits: ev.termCredits,
  };
}

export type PlanModel = ReturnType<typeof usePlan>;

/**
 * Pointer drag that follows the finger 1:1 with a floating ghost, hit-tests
 * [data-term-id] drop zones on release, and reports velocity (for tilt).
 */
export interface DragState {
  itemId: string;
  x: number;
  y: number;
  dx: number; // offset from pointer to element's top-left
  dy: number;
  w: number;
  vx: number;
  overTerm: string | null;
}

export function useDrag(onDrop: (itemId: string, termId: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);

  const start = useCallback(
    (e: React.PointerEvent<HTMLElement>, itemId: string) => {
      if (e.button !== 0) return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      let started = false;
      let lastX = sx;
      let lastT = performance.now();
      let vx = 0;
      let over: string | null = null;

      const termAt = (x: number, y: number) =>
        (document.elementsFromPoint(x, y).find((n) => n instanceof HTMLElement && n.dataset.termId) as HTMLElement | undefined)
          ?.dataset.termId ?? null;

      const moveH = (ev: PointerEvent) => {
        if (!started && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        started = true;
        const now = performance.now();
        const dt = Math.max(1, now - lastT);
        vx = vx * 0.6 + ((ev.clientX - lastX) / dt) * 0.4;
        lastX = ev.clientX;
        lastT = now;
        over = termAt(ev.clientX, ev.clientY);
        setDrag({ itemId, x: ev.clientX, y: ev.clientY, dx: sx - r.left, dy: sy - r.top, w: r.width, vx, overTerm: over });
      };
      const up = () => {
        window.removeEventListener("pointermove", moveH);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (started) {
          if (over) onDrop(itemId, over);
          // swallow the click that follows a drag
          const stop = (c: MouseEvent) => {
            c.stopPropagation();
            c.preventDefault();
          };
          window.addEventListener("click", stop, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
        }
        setDrag(null);
      };
      window.addEventListener("pointermove", moveH);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [onDrop],
  );

  return { drag, start };
}

/** Keyboard: ← / → moves the focused course one semester. */
export function keyMove(e: React.KeyboardEvent, itemId: string, shift: (id: string, by: number) => void) {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    shift(itemId, e.key === "ArrowLeft" ? -1 : 1);
    requestAnimationFrame(() => (document.querySelector(`[data-stop="${itemId}"]`) as HTMLElement | null)?.focus());
  }
}
