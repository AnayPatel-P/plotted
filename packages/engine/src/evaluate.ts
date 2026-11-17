/**
 * Requirement evaluation.
 *
 * Allocation works in two phases so specific rules win over general ones:
 *   1. course rules ("take C S 331") claim matching planned courses,
 *   2. credit-hour rules ("12 hours of upper-division C S") take what's left.
 * Exclusive areas (concentration, major, degree) share one "used" set, so a
 * course counts toward only one of them. Non-exclusive areas (core, total
 * hours) each get their own set and may reuse courses.
 *
 * Plan slots ("Upper-division C S, 3 hrs") never satisfy a course rule, but
 * they can fill a credit-hour rule with a compatible filter. A rule satisfied
 * only thanks to slots is "planned" rather than "met".
 */
import { checkPrereqs, type PrereqIssue, type PrereqNote } from "./prereq";
import type { Course, CourseFilter, Program, Rule, Term } from "./schema";

export type Status = "met" | "planned" | "partial" | "unmet" | "manual";

export interface RuleResult {
  id: string;
  label: string;
  type: Rule["type"];
  status: Status;
  /** For credit rules: hours counted (concrete + slots) and required. */
  hours?: { earned: number; planned: number; required: number };
  /** For nOf: children satisfied / needed. */
  count?: { done: number; required: number };
  /** Plan item ids counted toward this rule. */
  itemIds: string[];
  note?: string;
  children?: RuleResult[];
}

export interface AreaResult {
  id: string;
  label: string;
  result: RuleResult;
}

export interface Evaluation {
  areas: AreaResult[];
  prereqIssues: PrereqIssue[];
  prereqNotes: PrereqNote[];
  termCredits: Record<string, number>;
  totalCredits: number;
  unknownCourses: string[];
  /** Map of plan item id -> rule ids it counts toward (for highlighting). */
  itemRules: Record<string, string[]>;
}

/* ------------------------------------------------------------------ */

interface Unit {
  itemId: string;
  termIndex: number;
  credits: number;
  code?: string;
  course?: Course;
  slotFilter?: CourseFilter;
}

/** Fallback when a course isn't in the catalog: UT's first digit is the hours. */
function guessCredits(code: string): number {
  const m = code.match(/\s(\d)\d\d[A-Z]?$/);
  return m ? Number(m[1]) : 3;
}

export function courseMatches(course: Course, f: CourseFilter): boolean {
  if (f.exclude?.includes(course.code)) return false;
  if (f.excludeSubjects?.includes(course.subject)) return false;
  if (f.any) return true;
  if (f.codes && !f.codes.includes(course.code) && !course.crossListed?.some((x) => f.codes!.includes(x)))
    return false;
  if (f.subjects && !f.subjects.includes(course.subject)) return false;
  if (f.upperDivision !== undefined && course.upperDivision !== f.upperDivision) return false;
  if (f.core && !f.core.some((c) => course.core.includes(c))) return false;
  return !!(f.codes || f.subjects || f.upperDivision !== undefined || f.core || f.excludeSubjects);
}

/** A slot can fill a rule when every course the slot allows would also satisfy the rule. */
export function slotMatches(slot: CourseFilter, rule: CourseFilter): boolean {
  if (rule.any) return true;
  if (slot.any) return false;
  if (rule.core) return !!slot.core?.some((c) => rule.core!.includes(c));
  if (rule.subjects && !(slot.subjects && slot.subjects.every((s) => rule.subjects!.includes(s)))) return false;
  if (rule.upperDivision && !slot.upperDivision) return false;
  if (rule.excludeSubjects) {
    const allowed = slot.subjects ?? null;
    const excludedBySlot = (s: string) => slot.excludeSubjects?.includes(s) ?? false;
    // Every subject the slot allows must be outside the rule's excluded list.
    if (allowed ? allowed.some((s) => rule.excludeSubjects!.includes(s)) : !rule.excludeSubjects.every(excludedBySlot))
      return false;
  }
  if (rule.codes) return !!slot.codes && slot.codes.every((c) => rule.codes!.includes(c));
  return !!(rule.subjects || rule.upperDivision || rule.excludeSubjects);
}

/* ------------------------------------------------------------------ */

type Alloc = Map<string, Unit[]>; // rule id -> units

interface Ctx {
  units: Unit[];
  used: Set<string>;
  alloc: Alloc;
  /** nOf rule id -> chosen child indexes (decided in phase 1 when possible). */
  chosen: Map<string, number[]>;
}

const clone = (c: Ctx): Ctx => ({
  units: c.units,
  used: new Set(c.used),
  alloc: new Map(c.alloc),
  chosen: new Map(c.chosen),
});

function commit(into: Ctx, from: Ctx) {
  into.used = from.used;
  into.alloc = from.alloc;
  into.chosen = from.chosen;
}

/** Phase 1: course rules. Returns a 0..1 completion score. */
function phaseCourses(rule: Rule, ctx: Ctx): number {
  switch (rule.type) {
    case "course": {
      const codes = [rule.code, ...(rule.alternatives ?? [])];
      // A cross-listed course counts as the course it's listed with.
      const matches = (u: Unit) =>
        !!u.code && (codes.includes(u.code) || !!u.course?.crossListed?.some((x) => codes.includes(x)));
      const unit = ctx.units.find((u) => !ctx.used.has(u.itemId) && matches(u));
      if (!unit) return 0;
      ctx.used.add(unit.itemId);
      ctx.alloc.set(rule.id, [unit]);
      return 1;
    }
    case "allOf": {
      const kids = rule.rules.filter((r) => r.type !== "manual");
      if (!kids.length) return 0;
      let sum = 0;
      for (const r of kids) sum += phaseCourses(r, ctx);
      return sum / kids.length;
    }
    case "nOf":
      return chooseChildren(rule, ctx, phaseCourses, true);
    default:
      return 0;
  }
}

/**
 * Phase 2: credit-hour rules take what's left. Runs in two passes so narrow
 * rules win: "list" fills rules that name explicit courses ("3 hours from
 * M 374M, PHY 329, …"), then "rest" fills broad ones ("8 hours of PHY/CH/…").
 * Returns the rule's overall 0..1 completion.
 */
type Pass = "list" | "rest";

function creditsScore(rule: Extract<Rule, { type: "credits" }>, ctx: Ctx): number {
  const got = (ctx.alloc.get(rule.id) ?? []).reduce((s, u) => s + u.credits, 0);
  return Math.min(1, got / rule.hours);
}

function phaseCredits(rule: Rule, ctx: Ctx, pass: Pass = "rest"): number {
  switch (rule.type) {
    case "course":
      return ctx.alloc.get(rule.id)?.length ? 1 : 0;
    case "credits": {
      if (ctx.alloc.has(rule.id)) return creditsScore(rule, ctx);
      if (pass === "list" && !rule.filter.codes) return 0;
      let need = rule.hours;
      const taken: Unit[] = [];
      // Concrete courses first, then compatible slots.
      const concrete = ctx.units.filter(
        (u) => u.course && !ctx.used.has(u.itemId) && courseMatches(u.course, rule.filter),
      );
      const slots = ctx.units.filter(
        (u) => u.slotFilter && !ctx.used.has(u.itemId) && slotMatches(u.slotFilter, rule.filter),
      );
      for (const u of [...concrete, ...slots]) {
        if (need <= 0) break;
        taken.push(u);
        ctx.used.add(u.itemId);
        need -= u.credits;
      }
      ctx.alloc.set(rule.id, taken);
      return Math.min(1, (rule.hours - Math.max(need, 0)) / rule.hours);
    }
    case "allOf": {
      const kids = rule.rules.filter((r) => r.type !== "manual");
      if (!kids.length) return 0;
      let sum = 0;
      for (const r of kids) sum += phaseCredits(r, ctx, pass);
      return sum / kids.length;
    }
    case "nOf": {
      const decided = ctx.chosen.get(rule.id);
      if (decided) {
        let sum = 0;
        for (const i of decided) sum += phaseCredits(rule.rules[i]!, ctx, pass);
        return sum / rule.n;
      }
      // Undecided choices are settled in the final pass, comparing whole children.
      if (pass === "list") return 0;
      return chooseChildren(rule, ctx, (r, c) => phaseCredits(r, c, "rest"), false);
    }
    default:
      return 0;
  }
}

function chooseChildren(
  rule: Extract<Rule, { type: "nOf" }>,
  ctx: Ctx,
  phase: (r: Rule, c: Ctx) => number,
  recordChoice: boolean,
): number {
  // Greedily pick the best child n times, simulating each on a clone.
  const picked: number[] = [];
  let total = 0;
  for (let k = 0; k < rule.n; k++) {
    let best: { i: number; score: number; ctx: Ctx } | null = null;
    rule.rules.forEach((child, i) => {
      if (picked.includes(i) || child.type === "manual") return;
      const trial = clone(ctx);
      const score = phase(child, trial);
      if (!best || score > best.score) best = { i, score, ctx: trial };
    });
    const b = best as { i: number; score: number; ctx: Ctx } | null;
    if (!b || b.score === 0) break;
    commit(ctx, b.ctx);
    picked.push(b.i);
    total += b.score;
  }
  if (recordChoice && picked.length) ctx.chosen.set(rule.id, picked);
  return total / rule.n;
}

/* ------------------------------------------------------------------ */

function result(rule: Rule, ctx: Ctx): RuleResult {
  const units = ctx.alloc.get(rule.id) ?? [];
  const base = { id: rule.id, type: rule.type, itemIds: units.map((u) => u.itemId) };
  switch (rule.type) {
    case "course": {
      const label = rule.label ?? [rule.code, ...(rule.alternatives ?? [])].join(" or ");
      return { ...base, label, status: units.length ? "met" : "unmet" };
    }
    case "credits": {
      const earned = units.filter((u) => !u.slotFilter).reduce((s, u) => s + u.credits, 0);
      const planned = units.reduce((s, u) => s + u.credits, 0);
      const status: Status =
        earned >= rule.hours ? "met" : planned >= rule.hours ? "planned" : planned > 0 ? "partial" : "unmet";
      return { ...base, label: rule.label, status, hours: { earned, planned, required: rule.hours } };
    }
    case "manual":
      return { ...base, label: rule.label, status: "manual", note: rule.note };
    case "allOf": {
      const children = rule.rules.map((r) => result(r, ctx));
      const checked = children.filter((c) => c.status !== "manual");
      const status: Status = !checked.length
        ? "manual"
        : checked.every((c) => c.status === "met")
          ? "met"
          : checked.every((c) => c.status === "met" || c.status === "planned")
            ? "planned"
            : checked.some((c) => c.status !== "unmet")
              ? "partial"
              : "unmet";
      return { ...base, label: rule.label, status, children, itemIds: children.flatMap((c) => c.itemIds) };
    }
    case "nOf": {
      const children = rule.rules.map((r) => result(r, ctx));
      const met = children.filter((c) => c.status === "met").length;
      const plannedOrMet = children.filter((c) => c.status === "met" || c.status === "planned").length;
      const status: Status =
        met >= rule.n
          ? "met"
          : plannedOrMet >= rule.n
            ? "planned"
            : children.some((c) => c.status === "partial" || c.status === "met" || c.status === "planned")
              ? "partial"
              : "unmet";
      return {
        ...base,
        label: rule.label,
        status,
        count: { done: met, required: rule.n },
        children,
        itemIds: children.flatMap((c) => c.itemIds),
      };
    }
  }
}

/* ------------------------------------------------------------------ */

export function evaluate(program: Program, courses: Map<string, Course>, terms: Term[]): Evaluation {
  const units: Unit[] = [];
  const unknown = new Set<string>();
  const termCredits: Record<string, number> = {};
  terms.forEach((term, termIndex) => {
    let sum = 0;
    for (const item of term.items) {
      if (item.kind === "course") {
        const course = courses.get(item.code);
        if (!course) unknown.add(item.code);
        const credits = course?.credits ?? guessCredits(item.code);
        units.push({ itemId: item.id, termIndex, credits, code: item.code, course });
        sum += credits;
      } else {
        units.push({ itemId: item.id, termIndex, credits: item.credits, slotFilter: item.filter });
        sum += item.credits;
      }
    }
    termCredits[term.id] = sum;
  });

  const shared: Ctx = { units, used: new Set(), alloc: new Map(), chosen: new Map() };
  const ctxFor = new Map<string, Ctx>();
  for (const a of program.areas) {
    ctxFor.set(a.id, a.exclusive ? shared : { units, used: new Set(), alloc: new Map(), chosen: new Map() });
  }

  // Phase 1 then phase 2, in area order, across all areas.
  for (const a of program.areas) phaseCourses(a.rule, ctxFor.get(a.id)!);
  for (const pass of ["list", "rest"] as const) {
    for (const a of program.areas) phaseCredits(a.rule, ctxFor.get(a.id)!, pass);
  }

  const areas = program.areas.map((a) => ({ id: a.id, label: a.label, result: result(a.rule, ctxFor.get(a.id)!) }));

  const itemRules: Record<string, string[]> = {};
  const walk = (r: RuleResult) => {
    if (!r.children) for (const id of r.itemIds) (itemRules[id] ??= []).push(r.id);
    r.children?.forEach(walk);
  };
  areas.forEach((a) => walk(a.result));

  const { issues, notes } = checkPrereqs(terms, courses);
  return {
    areas,
    prereqIssues: issues,
    prereqNotes: notes,
    termCredits,
    totalCredits: Object.values(termCredits).reduce((s, n) => s + n, 0),
    unknownCourses: [...unknown],
    itemRules,
  };
}

/* ------------------------------------------------------------------ */
/* Suggestions                                                         */
/* ------------------------------------------------------------------ */

const RANK: Record<Status, number> = { unmet: 0, partial: 1, planned: 2, met: 3, manual: -1 };

/** Course codes named by rules that aren't Met yet (course rules and course-list credit rules). */
export function openRequirementCodes(program: Program, ev: Evaluation): Set<string> {
  const status = new Map<string, Status>();
  const collect = (r: RuleResult) => {
    status.set(r.id, r.status);
    r.children?.forEach(collect);
  };
  ev.areas.forEach((a) => collect(a.result));
  const out = new Set<string>();
  const walk = (rule: Rule) => {
    const st = status.get(rule.id);
    if (st === "met" || st === "manual") return;
    if (rule.type === "course") [rule.code, ...(rule.alternatives ?? [])].forEach((c) => out.add(c));
    if (rule.type === "credits") rule.filter.codes?.forEach((c) => out.add(c));
    if (rule.type === "allOf" || rule.type === "nOf") rule.rules.forEach(walk);
  };
  program.areas.forEach((a) => walk(a.rule));
  return out;
}

export interface Improvement {
  label: string;
  /** "met" = the change completes it; otherwise it moves it closer. */
  status: Status;
}

/**
 * What a change would improve: the most specific non-course rules whose status
 * gets better between two evaluations (e.g. "Chemistry (CH 301, 302)"). A
 * single-course rule is reported through its parent group.
 */
export function improvements(before: Evaluation, after: Evaluation): Improvement[] {
  const prev = new Map<string, Status>();
  before.areas.forEach((a) => walkResults(a.result, (r) => prev.set(r.id, r.status)));
  const out: Improvement[] = [];
  // Returns true when this subtree already reported something more specific.
  const visit = (r: RuleResult): boolean => {
    const reportedBelow = (r.children ?? []).map(visit).some(Boolean);
    if (reportedBelow) return true;
    const improved = RANK[r.status] > RANK[prev.get(r.id) ?? "unmet"];
    if (improved && r.type !== "course") {
      out.push({ label: r.label, status: r.status });
      return true;
    }
    return false;
  };
  after.areas.forEach((a) => visit(a.result));
  return out;
}

function walkResults(r: RuleResult, fn: (r: RuleResult) => void) {
  fn(r);
  r.children?.forEach((c) => walkResults(c, fn));
}
