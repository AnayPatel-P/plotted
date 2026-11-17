/**
 * Planner state: the student's terms (semesters) and any catalog courses they
 * added that weren't in the program's own course slice. Pure reducer, plus
 * versioned browser storage.
 */
import { Course, Term, type PlanItem } from "@plotted/engine";
import { z } from "zod";

export interface PlanState {
  terms: Term[];
  /** Course records fetched from search, so titles/credits survive a reload. */
  extraCourses: Course[];
  /** v2: the student's first semester, e.g. "Fall 2025" (null/absent = not set). */
  startTerm?: string | null;
}

export const CREDIT_TERM_ID = "credit";
export const CREDIT_LABEL = "Credit before college";

export type Action =
  | { type: "move"; itemId: string; toTermId: string; toIndex?: number }
  | { type: "remove"; itemId: string }
  | { type: "add"; termId: string; course: Course }
  | { type: "fill"; slotId: string; course: Course }
  | { type: "addTerm"; season: "Fall" | "Spring" | "Summer"; afterTermId?: string }
  | { type: "removeTerm"; termId: string }
  | { type: "reset"; terms: Term[] }
  | { type: "setStartTerm"; startTerm: string | null }
  | { type: "addCredit"; course: Course }
  | { type: "load"; state: PlanState };

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

function parseTermLabel(label: string): { year: number; season: string } {
  const m = label.match(/Year (\d+) · (\w+)/);
  return m ? { year: Number(m[1]), season: m[2]! } : { year: 1, season: "Fall" };
}

function withCourse(state: PlanState, course: Course): Course[] {
  return state.extraCourses.some((c) => c.code === course.code) ? state.extraCourses : [...state.extraCourses, course];
}

export function reducer(state: PlanState, action: Action): PlanState {
  switch (action.type) {
    case "move": {
      let moving: PlanItem | undefined;
      const without = state.terms.map((t) => {
        const i = t.items.findIndex((x) => x.id === action.itemId);
        if (i === -1) return t;
        moving = t.items[i];
        return { ...t, items: t.items.filter((_, j) => j !== i) };
      });
      if (!moving) return state;
      const item = moving;
      // Dropping onto the (not yet created) credit column creates it.
      if (action.toTermId === CREDIT_TERM_ID && !without.some((t) => t.id === CREDIT_TERM_ID)) {
        without.unshift({ id: CREDIT_TERM_ID, label: CREDIT_LABEL, kind: "credit", items: [] });
      }
      return {
        ...state,
        terms: without.map((t) => {
          if (t.id !== action.toTermId) return t;
          const items = [...t.items];
          items.splice(action.toIndex ?? items.length, 0, item);
          return { ...t, items };
        }),
      };
    }
    case "remove":
      // A course picked for a placeholder gives the placeholder back; anything else goes.
      return {
        ...state,
        terms: state.terms.map((t) => ({
          ...t,
          items: t.items.flatMap((i) =>
            i.id !== action.itemId ? [i] : i.kind === "course" && i.placeholder ? [i.placeholder] : [],
          ),
        })),
      };
    case "add":
      return {
        ...state,
        terms: state.terms.map((t) =>
          t.id === action.termId
            ? { ...t, items: [...t.items, { kind: "course", id: newId("c"), code: action.course.code }] }
            : t,
        ),
        extraCourses: withCourse(state, action.course),
      };
    case "fill":
      return {
        ...state,
        terms: state.terms.map((t) => ({
          ...t,
          items: t.items.map((i) =>
            i.id === action.slotId && i.kind === "slot"
              ? { kind: "course" as const, id: newId("c"), code: action.course.code, placeholder: i }
              : i,
          ),
        })),
        extraCourses: withCourse(state, action.course),
      };
    case "addTerm": {
      const terms = [...state.terms];
      const anchorIdx = action.afterTermId ? terms.findIndex((t) => t.id === action.afterTermId) : terms.length - 1;
      const anchor = terms[anchorIdx];
      const { year, season } = anchor ? parseTermLabel(anchor.label) : { year: 0, season: "Spring" };
      let next: { year: number; season: string };
      if (action.season === "Summer") next = { year, season: "Summer" };
      else next = season === "Fall" ? { year, season: "Spring" } : { year: year + 1, season: "Fall" };
      const id = `y${next.year}-${next.season.toLowerCase()}-${newId("t")}`;
      terms.splice(anchorIdx + 1, 0, { id, label: `Year ${next.year} · ${next.season}`, items: [] });
      return { ...state, terms };
    }
    case "removeTerm":
      return { ...state, terms: state.terms.filter((t) => t.id !== action.termId || t.items.length > 0) };
    case "reset": {
      // Credit before college is the student's real credit, not a plan choice: keep it.
      const credit = state.terms.find((t) => t.kind === "credit");
      const creditCodes = new Set(credit?.items.flatMap((i) => (i.kind === "course" ? [i.code] : [])) ?? []);
      return {
        terms: credit ? [credit, ...action.terms.filter((t) => t.kind !== "credit")] : action.terms,
        extraCourses: state.extraCourses.filter((c) => creditCodes.has(c.code)),
        startTerm: state.startTerm ?? null,
      };
    }
    case "setStartTerm":
      return { ...state, startTerm: action.startTerm };
    case "addCredit": {
      // Already planned in a semester? Then credit replaces taking it: move that item.
      const planned = state.terms.find(
        (t) => t.kind !== "credit" && t.items.some((i) => i.kind === "course" && i.code === action.course.code),
      );
      const plannedItem = planned?.items.find((i) => i.kind === "course" && i.code === action.course.code);
      const item = plannedItem ?? { kind: "course" as const, id: newId("c"), code: action.course.code };
      const base = plannedItem
        ? state.terms.map((t) => (t === planned ? { ...t, items: t.items.filter((i) => i !== plannedItem) } : t))
        : state.terms;
      const has = base.some((t) => t.kind === "credit");
      const terms = has
        ? base.map((t) => (t.kind === "credit" ? { ...t, items: [...t.items, item] } : t))
        : [{ id: CREDIT_TERM_ID, label: CREDIT_LABEL, kind: "credit" as const, items: [item] }, ...base];
      return { ...state, terms, extraCourses: withCourse(state, action.course) };
    }
    case "load":
      return action.state;
  }
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

const Stored = z.object({
  v: z.literal(1),
  terms: z.array(Term),
  extraCourses: z.array(Course).default([]),
  savedAt: z.string(),
  /** Account plan this browser copy is linked to, once synced. */
  remoteId: z.string().nullable().optional(),
  startTerm: z.string().nullable().optional(),
});

export const storageKey = (school: string, year: string, programId: string) =>
  `plotted:plan:${school}/${year}/${programId}`;

export function loadSaved(
  key: string,
): (PlanState & { savedAt: string; remoteId?: string | null; startTerm?: string | null }) | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = Stored.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function save(key: string, state: PlanState, remoteId?: string | null) {
  try {
    const value: z.input<typeof Stored> = { v: 1, ...state, savedAt: new Date().toISOString(), remoteId };
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode): the plan still works for this visit.
  }
}

/** Remove every Plotted plan from this browser (used on sign-out). */
export function clearAllSaved() {
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith("plotted:plan:")) window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function clearSaved(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** An empty plan with the standard 8 semesters. */
export function emptyTerms(): Term[] {
  return Array.from({ length: 8 }, (_, i) => {
    const year = Math.floor(i / 2) + 1;
    const season = i % 2 === 0 ? "Fall" : "Spring";
    return { id: `y${year}-${season.toLowerCase()}`, label: `Year ${year} · ${season}`, items: [] };
  });
}

/**
 * "Copy into my plan" replaces the plan saved in this browser without asking; the old one is kept
 * under a side key so the planner page it lands on can offer Undo once.
 */
const replacedKey = (key: string) => `${key}:replaced`;

export function keepReplaced(key: string) {
  try {
    const old = window.localStorage.getItem(key);
    if (old) window.localStorage.setItem(replacedKey(key), old);
  } catch {
    /* ignore */
  }
}

export function takeReplaced(key: string): string | null {
  try {
    const old = window.localStorage.getItem(replacedKey(key));
    window.localStorage.removeItem(replacedKey(key));
    return old;
  } catch {
    return null;
  }
}

export function restoreReplaced(key: string, raw: string) {
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    /* ignore */
  }
}
