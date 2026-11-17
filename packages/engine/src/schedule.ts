/**
 * Schedule analysis over the prerequisite graph: critical path, slack, and
 * graduation-delay detection.
 *
 * Terms are counted in plan order (summers count as a term). A prerequisite
 * edge costs one term, a "same term is fine" edge costs zero.
 *
 * For each planned course:
 *   depth  = longest chain of prerequisites leading into it (in terms)
 *   tail   = longest chain of planned courses that depend on it (in terms)
 *   slack  = how many terms later it could move before its chain runs past
 *            the last planned term
 * A course whose chain already runs past the last term gets a delay warning
 * naming the chain.
 */
import { prereqEdges, type PrereqEdge } from "./graph";
import type { Course, Term } from "./schema";

export interface ItemSchedule {
  itemId: string;
  code: string;
  termIndex: number;
  depth: number;
  tail: number;
  /** Terms this course can slip without delaying graduation (negative = already too late). */
  slack: number;
  /** No slack and part of a chain: moving it later delays graduation. */
  critical: boolean;
  /** The longest chain this course heads, as codes (including itself). */
  chain: string[];
}

export interface DelayWarning {
  itemId: string;
  code: string;
  /** Courses in the chain, starting with this one. */
  chain: string[];
  /** Terms needed after this course's term vs. terms left in the plan. */
  termsNeeded: number;
  termsLeft: number;
}

export interface ScheduleAnalysis {
  items: Map<string, ItemSchedule>;
  edges: PrereqEdge[];
  /** Index of the last term that has anything in it ("planned graduation"). */
  lastTerm: number;
  delays: DelayWarning[];
  /** The longest prerequisite chain in the whole plan, as item ids. */
  longestChain: string[];
}

export interface ScheduleOptions {
  /** Terms before this index are fixed (credit, completed): no warnings or "no slack" there. */
  changeableFrom?: number;
}

export function analyzeSchedule(terms: Term[], courses: Map<string, Course>, options: ScheduleOptions = {}): ScheduleAnalysis {
  const changeableFrom = options.changeableFrom ?? 0;
  const edges = prereqEdges(terms, courses);
  const info = new Map<string, { code: string; termIndex: number; credit: boolean }>();
  terms.forEach((t, ti) =>
    t.items.forEach((i) => {
      if (i.kind === "course") info.set(i.id, { code: i.code, termIndex: ti, credit: t.kind === "credit" });
    }),
  );
  const out = new Map<string, PrereqEdge[]>();
  const into = new Map<string, PrereqEdge[]>();
  for (const e of edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
    (into.get(e.to) ?? into.set(e.to, []).get(e.to)!).push(e);
  }
  // Credit before college doesn't use up a semester, so links out of it cost nothing.
  const cost = (e: PrereqEdge) => (e.concurrent || info.get(e.from)?.credit ? 0 : 1);

  // Longest paths on a DAG (memoized DFS; a cycle — only possible with
  // malformed data — is cut at the repeated node).
  const tailMemo = new Map<string, { len: number; next?: string }>();
  const tailOf = (id: string, seen = new Set<string>()): { len: number; next?: string } => {
    if (tailMemo.has(id)) return tailMemo.get(id)!;
    if (seen.has(id)) return { len: 0 };
    seen.add(id);
    let best: { len: number; next?: string } = { len: 0 };
    for (const e of out.get(id) ?? []) {
      const len = cost(e) + tailOf(e.to, seen).len;
      if (len > best.len || (len === best.len && best.next === undefined)) best = { len, next: e.to };
    }
    seen.delete(id);
    tailMemo.set(id, best);
    return best;
  };
  const depthMemo = new Map<string, { len: number; prev?: string }>();
  const depthOf = (id: string, seen = new Set<string>()): { len: number; prev?: string } => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (seen.has(id)) return { len: 0 };
    seen.add(id);
    let best: { len: number; prev?: string } = { len: 0 };
    for (const e of into.get(id) ?? []) {
      const len = cost(e) + depthOf(e.from, seen).len;
      if (len > best.len || (len === best.len && best.prev === undefined)) best = { len, prev: e.from };
    }
    seen.delete(id);
    depthMemo.set(id, best);
    return best;
  };

  let lastTerm = -1;
  terms.forEach((t, i) => {
    if (t.items.length && t.kind !== "credit") lastTerm = i;
  });

  const chainFrom = (id: string): string[] => {
    const ids = [id];
    let cur = tailOf(id).next;
    while (cur && !ids.includes(cur)) {
      ids.push(cur);
      cur = tailOf(cur).next;
    }
    return ids;
  };

  const items = new Map<string, ItemSchedule>();
  const delays: DelayWarning[] = [];
  for (const [id, { code, termIndex, credit }] of info) {
    const fixed = credit || termIndex < changeableFrom;
    const tail = tailOf(id).len;
    const depth = depthOf(id).len;
    const slack = lastTerm - (termIndex + tail);
    const chainIds = chainFrom(id);
    const chain = chainIds.map((x) => info.get(x)!.code);
    items.set(id, {
      itemId: id,
      code,
      termIndex,
      depth,
      tail,
      slack,
      critical: !fixed && slack <= 0 && (tail > 0 || depth > 0),
      chain,
    });
    // Only warn at the head of an overrunning chain: if a prerequisite of this
    // course also overruns, that course carries the warning instead.
    const headOverruns = !fixed && slack < 0;
    const upstreamOverruns = (into.get(id) ?? []).some((e) => {
      const up = info.get(e.from);
      return (
        up &&
        !up.credit &&
        up.termIndex >= changeableFrom &&
        lastTerm - (up.termIndex + tailOf(e.from).len) < 0 &&
        tailOf(e.from).next !== undefined
      );
    });
    if (headOverruns && !upstreamOverruns) {
      delays.push({ itemId: id, code, chain, termsNeeded: tail, termsLeft: lastTerm - termIndex });
    }
  }

  // Longest chain overall: start from the deepest end node and walk back.
  let end: string | undefined;
  let endLen = -1;
  for (const id of info.keys()) {
    const d = depthOf(id).len;
    if (d > endLen) {
      endLen = d;
      end = id;
    }
  }
  const longestChain: string[] = [];
  for (let cur = end; cur && !longestChain.includes(cur); cur = depthOf(cur).prev) longestChain.unshift(cur);

  return { items, edges, lastTerm, delays, longestChain: endLen > 0 ? longestChain : [] };
}
