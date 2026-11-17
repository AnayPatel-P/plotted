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
}

export type Action =
  | { type: "move"; itemId: string; toTermId: string; toIndex?: number }
  | { type: "remove"; itemId: string }
  | { type: "add"; termId: string; course: Course }
  | { type: "fill"; slotId: string; course: Course }
  | { type: "addTerm"; season: "Fall" | "Spring" | "Summer"; afterTermId?: string }
  | { type: "removeTerm"; termId: string }
  | { type: "reset"; terms: Term[] }
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
      return { ...state, terms: state.terms.map((t) => ({ ...t, items: t.items.filter((i) => i.id !== action.itemId) })) };
    case "add":
      return {
        terms: state.terms.map((t) =>
          t.id === action.termId
            ? { ...t, items: [...t.items, { kind: "course", id: newId("c"), code: action.course.code }] }
            : t,
        ),
        extraCourses: withCourse(state, action.course),
      };
    case "fill":
      return {
        terms: state.terms.map((t) => ({
          ...t,
          items: t.items.map((i) =>
            i.id === action.slotId ? { kind: "course" as const, id: newId("c"), code: action.course.code } : i,
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
    case "reset":
      return { terms: action.terms, extraCourses: [] };
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
});

export const storageKey = (school: string, year: string, programId: string) =>
  `plotted:plan:${school}/${year}/${programId}`;

export function loadSaved(key: string): (PlanState & { savedAt: string }) | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = Stored.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function save(key: string, state: PlanState) {
  try {
    const value: z.input<typeof Stored> = { v: 1, ...state, savedAt: new Date().toISOString() };
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked (private mode): the plan still works for this visit.
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
