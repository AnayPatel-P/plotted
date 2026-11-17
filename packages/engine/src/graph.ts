/**
 * Prerequisite graph over a plan: which planned courses feed which.
 * Used for the "route" highlight (and, in Phase 4, unlocks + delay warnings).
 */
import { equivalents } from "./prereq";
import type { Course, Prereq, Term } from "./schema";

export interface PrereqEdge {
  /** Plan item id of the prerequisite course. */
  from: string;
  /** Plan item id of the course that needs it. */
  to: string;
  concurrent: boolean;
}

function leaves(p: Prereq, out: { course: string; concurrent: boolean }[] = []) {
  if ("course" in p) out.push({ course: p.course, concurrent: !!p.concurrent });
  else if ("all" in p) p.all.forEach((c) => leaves(c, out));
  else if ("any" in p) p.any.forEach((c) => leaves(c, out));
  return out;
}

/** Edges from each planned course to the planned courses whose prerequisites it appears in. */
export function prereqEdges(terms: Term[], courses: Map<string, Course>): PrereqEdge[] {
  // code (and cross-listed codes) -> plan items with that code, in plan order
  const byCode = new Map<string, { id: string; term: number }[]>();
  terms.forEach((t, ti) =>
    t.items.forEach((i) => {
      if (i.kind !== "course") return;
      for (const code of equivalents(i.code, courses)) {
        const list = byCode.get(code) ?? [];
        list.push({ id: i.id, term: ti });
        byCode.set(code, list);
      }
    }),
  );

  const edges: PrereqEdge[] = [];
  terms.forEach((t, ti) =>
    t.items.forEach((item) => {
      if (item.kind !== "course") return;
      const prereq = courses.get(item.code)?.prereq;
      if (!prereq) return;
      const seen = new Set<string>();
      for (const leaf of leaves(prereq)) {
        // Prefer the latest planned copy that comes before (or with, if concurrent) this course.
        const candidates = (byCode.get(leaf.course) ?? []).filter(
          (c) => c.id !== item.id && (c.term < ti || (leaf.concurrent && c.term === ti)),
        );
        const src = candidates.at(-1) ?? (byCode.get(leaf.course) ?? []).find((c) => c.id !== item.id);
        if (src && !seen.has(src.id)) {
          seen.add(src.id);
          edges.push({ from: src.id, to: item.id, concurrent: leaf.concurrent });
        }
      }
    }),
  );
  return edges;
}

/** Every item upstream (prerequisites, recursively) and downstream (unlocks, recursively) of `itemId`. */
export function routeOf(itemId: string, edges: PrereqEdge[]) {
  const walk = (start: string, next: (id: string) => string[]) => {
    const out = new Set<string>();
    const stack = [start];
    while (stack.length) {
      for (const n of next(stack.pop()!)) {
        if (!out.has(n) && n !== itemId) {
          out.add(n);
          stack.push(n);
        }
      }
    }
    return out;
  };
  const upstream = walk(itemId, (id) => edges.filter((e) => e.to === id).map((e) => e.from));
  const downstream = walk(itemId, (id) => edges.filter((e) => e.from === id).map((e) => e.to));
  const inRoute = new Set([itemId, ...upstream, ...downstream]);
  return {
    upstream,
    downstream,
    edges: edges.filter((e) => inRoute.has(e.from) && inRoute.has(e.to)),
  };
}
