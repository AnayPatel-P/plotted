/**
 * Hand-checked sample plans against the real scraped catalogs.
 *
 * Each expectation was worked out by reading the catalog page for the major
 * (linked from the program's sourceUrl) before running the engine. If one of
 * these fails after a data refresh, either the catalog changed or the
 * pipeline broke — check review.md and the catalog before "fixing" the test.
 */
import { describe, expect, it } from "vitest";
import { evaluate, type Evaluation, type RuleResult } from "../src/evaluate";
import type { PlanItem, Program, Term } from "../src/schema";
import { loadProgram } from "./load";

let n = 0;
const course = (code: string): PlanItem => ({ kind: "course", id: `s${++n}`, code });
const plan = (...terms: string[][]): Term[] =>
  terms.map((codes, i) => ({ id: `t${i + 1}`, label: `Term ${i + 1}`, items: codes.map(course) }));

/** Copy a plan, replacing one course code with others (in the same term). */
function swap(terms: Term[], from: string, ...to: string[]): Term[] {
  let found = false;
  const out = terms.map((t) => ({
    ...t,
    items: t.items.flatMap((i) => {
      if (i.kind === "course" && i.code === from) {
        found = true;
        return to.map(course);
      }
      return [i];
    }),
  }));
  if (!found) throw new Error(`${from} not in plan`);
  return out;
}

const areaStatus = (ev: Evaluation) => Object.fromEntries(ev.areas.map((a) => [a.id, a.result.status]));

function find(r: RuleResult, id: string): RuleResult | undefined {
  if (r.id === id) return r;
  for (const c of r.children ?? []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
}
const rule = (ev: Evaluation, id: string) => {
  for (const a of ev.areas) {
    const hit = find(a.result, id);
    if (hit) return hit;
  }
  throw new Error(`no rule ${id}`);
};

/**
 * The most specific rules that are unmet or only partly met. "Planned" rules
 * (filled by placeholder slots) and manual checks don't count as gaps; an
 * unmet "choose one" group is reported as the group, not its options.
 */
function gaps(ev: Evaluation): string[] {
  const out: string[] = [];
  const walk = (r: RuleResult) => {
    if (r.status !== "unmet" && r.status !== "partial") return;
    if (!r.children || r.type === "nOf") return void out.push(`${r.id}:${r.status}`);
    const before = out.length;
    r.children.forEach(walk);
    if (out.length === before) out.push(`${r.id}:${r.status}`);
  };
  ev.areas.forEach((a) => walk(a.result));
  return out.sort();
}

/* ------------------------------------------------------------------ */
/* UT Austin — Computer Science BS                                     */
/* ------------------------------------------------------------------ */

describe("UT Austin CS BS", () => {
  const { program, courses } = loadProgram("ut-austin", "2026-28", "ut-cs-bs");
  const run = (terms: Term[]) => evaluate(program as Program, courses, terms);

  // A complete 120-hour plan built from real courses.
  const full = plan(
    ["C S 312", "M 408C", "HIS 315K", "ECO 304K", "UGS 302"],
    ["C S 311", "C S 314", "M 408D", "HIS 315L", "RHE 306"],
    ["C S 429", "SDS 321", "GOV 310L", "ARH 301", "C S 103F", "CH 301"],
    ["C S 439", "M 340L", "GOV 312L", "CH 302", "E 316L"],
    ["C S 331", "C S 373", "C S 375", "GEO 303", "SPN 601D"],
    ["C S 371P", "C S 356", "C S 361", "SPN 610D"],
    ["C S 343", "C S 341", "C S 378", "PHL 301", "ANT 302"],
    ["AST 301", "HIS 317L", "C S 109"],
  );

  it("1. catalog suggested plan: only the gaps the catalog leaves open", () => {
    const ev = run(program.suggestedPlan);
    expect(ev.totalCredits).toBe(120);
    expect(ev.prereqIssues).toEqual([]);
    // The catalog plan never picks the science sequence, the 3 concentration
    // science/math hours, or a second Communication (010) course.
    expect(gaps(ev)).toEqual(["conc.science:unmet", "core.010.list:unmet", "major.science:unmet"]);
  });

  it("2. complete plan: every checkable requirement met, no prereq problems", () => {
    const ev = run(full);
    expect(ev.totalCredits).toBe(120);
    expect(ev.prereqIssues).toEqual([]);
    expect(areaStatus(ev)).toEqual({ concentration: "met", major: "met", degree: "manual", core: "met", total: "met" });
    // C S 373 carries the 010 flag, so it completes Communication alongside RHE 306.
    expect(rule(ev, "core.010").status).toBe("met");
  });

  it("3. calculus through Sequence 2 (408N, 408S, 408M)", () => {
    const ev = run(swap(swap(swap(full, "M 408C", "M 408N"), "M 408D", "M 408S"), "C S 103F", "C S 103F", "M 408M"));
    expect(ev.prereqIssues).toEqual([]);
    const calc = rule(ev, "major.r1");
    expect(calc.status).toBe("met");
    expect(calc.children!.find((c) => c.status === "met")!.label).toBe("Sequence 2");
    expect(areaStatus(ev).major).toBe("met");
  });

  it("4. science through physics Part A (303K + 105M) and Part B (303L + 105N)", () => {
    const ev = run(swap(swap(full, "CH 301", "PHY 303K", "PHY 105M"), "CH 302", "PHY 303L", "PHY 105N"));
    expect(ev.prereqIssues).toEqual([]);
    expect(rule(ev, "major.science.phy").status).toBe("met");
    expect(rule(ev, "core.030").status).toBe("met");
    expect(areaStatus(ev).major).toBe("met");
  });

  it("5. Data Structures before Intro to Programming is flagged", () => {
    const bad = full.map((t) => ({ ...t, items: [...t.items] }));
    const [y1f, y1s] = [bad[0]!, bad[1]!];
    const i312 = y1f.items.findIndex((i) => i.kind === "course" && i.code === "C S 312");
    const i314 = y1s.items.findIndex((i) => i.kind === "course" && i.code === "C S 314");
    [y1f.items[i312], y1s.items[i314]] = [y1s.items[i314]!, y1f.items[i312]!];
    const ev = run(bad);
    // C S 311 (same term as the moved C S 312) also requires C S 312 first.
    expect(ev.prereqIssues.map((i) => [i.code, i.missing])).toEqual([
      ["C S 314", ["one of C S 312, C S 312H"]],
      ["C S 311", ["one of C S 312, C S 312H"]],
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* UT Austin — Mathematics BS                                          */
/* ------------------------------------------------------------------ */

describe("UT Austin Math BS", () => {
  const { program, courses } = loadProgram("ut-austin", "2026-28", "ut-math-bs");
  const run = (terms: Term[]) => evaluate(program as Program, courses, terms);
  const suggested = program.suggestedPlan;

  it("1. catalog suggested plan: open slots plus the catalog's own prerequisite problems", () => {
    const ev = run(suggested);
    expect(ev.totalCredits).toBe(120);
    // PHY 329 (Math in Context) needs PHY 315/115L, which the plan never schedules;
    // M 365D/365G need M 365C, but the plan lists "M 361K or M 365C".
    expect(ev.prereqIssues.map((i) => i.code).sort()).toEqual(["M 365D", "M 365G", "PHY 329"]);
    // Science slots are "majors-level" and may not be core 030 courses, so core 030 is open.
    expect(gaps(ev)).toEqual(["core.030:unmet"]);
    expect(rule(ev, "conc.r15").status).toBe("met"); // Math in Context via PHY 329
  });

  it("2. taking M 365C instead of M 361K clears the real-analysis prerequisite warnings", () => {
    const fixed = suggested.map((t) => ({
      ...t,
      items: t.items.map((i) => (i.kind === "course" && i.code === "M 361K" ? { ...i, code: "M 365C" } : i)),
    }));
    const ev = run(fixed);
    expect(ev.prereqIssues.map((i) => i.code)).toEqual(["PHY 329"]);
  });

  it("3. Math in Context with C S 341 instead of PHY 329", () => {
    const ev = run(swap(suggested, "PHY 329", "C S 341"));
    expect(rule(ev, "conc.r15").status).toBe("met");
    expect(rule(ev, "conc.r15").itemIds).toHaveLength(1);
  });

  it("4. calculus through Sequence 3 (408K, 408L)", () => {
    const ev = run(swap(swap(suggested, "M 408N", "M 408K"), "M 408S", "M 408L"));
    const calc = rule(ev, "conc.r3");
    expect(calc.status).toBe("met");
    expect(calc.children!.find((c) => c.status === "met")!.label).toBe("Sequence 3");
  });

  it("5. majors-level science from physics fills the science hours and core 030", () => {
    let terms = suggested.map((t) => ({
      ...t,
      items: t.items.filter((i) => !(i.kind === "slot" && i.label.startsWith("Majors-level"))),
    }));
    terms = [{ id: "sci", label: "Science", items: ["PHY 301", "PHY 101L", "PHY 316", "PHY 116L"].map(course) }, ...terms];
    const ev = run(terms);
    expect(rule(ev, "conc.science").status).toBe("met");
    expect(rule(ev, "core.030").status).toBe("met");
  });
});

/* ------------------------------------------------------------------ */
/* Texas A&M — Data Engineering BS                                     */
/* ------------------------------------------------------------------ */

/** Replace slots (by item id) with one or more real courses. */
function fill(terms: Term[], picks: Record<string, string[]>): Term[] {
  return terms.map((t) => ({
    ...t,
    items: t.items.flatMap((i) => (picks[i.id] ? picks[i.id]!.map(course) : [i])),
  }));
}

describe("Texas A&M Data Engineering BS", () => {
  const { program, courses } = loadProgram("tamu", "2026-27", "tamu-daen-bs");
  const run = (terms: Term[]) => evaluate(program as Program, courses, terms);
  const suggested = program.suggestedPlan;

  // The catalog plan with every core and elective slot filled by a real course.
  const full = fill(suggested, {
    "y1-fall-6": ["HIST 105"],
    "y1-spring-4": ["HIST 106"],
    "y1-spring-5": ["POLS 206"],
    "y3-spring-6": ["POLS 207"],
    "y4-fall-5": ["ARCH 249"],
    "y4-fall-6": ["DAEN 410"],
    "y4-spring-2": ["PHIL 111"],
    "y4-spring-3": ["DAEN 420", "DAEN 430"],
    "y4-spring-4": ["ISEN 414"],
  });

  it("1. catalog suggested plan: valid as written, only open slots", () => {
    const ev = run(suggested);
    expect(ev.totalCredits).toBe(128);
    // DAEN 300 requires ECEN 360; the plan's CSCE 305 is the same cross-listed course.
    // CHEM 117 allows "registration therein" (same term as CHEM 107).
    expect(ev.prereqIssues).toEqual([]);
    expect(gaps(ev)).toEqual([]);
  });

  it("2. every slot filled: major, core, and total hours met", () => {
    const ev = run(full);
    expect(ev.totalCredits).toBe(128);
    expect(ev.prereqIssues).toEqual([]);
    expect(areaStatus(ev)).toEqual({ major: "met", grad: "manual", core: "met", total: "met" });
  });

  it("3. STAT 315 (cross-listed) in place of CSCE 305 still satisfies the major and DAEN 300", () => {
    const ev = run(swap(full, "CSCE 305", "STAT 315"));
    expect(ev.prereqIssues).toEqual([]);
    expect(areaStatus(ev).major).toBe("met");
  });

  it("4. Data Structures before Program Design is flagged", () => {
    const early = full.map((t) => ({ ...t, items: t.items.filter((i) => !(i.kind === "course" && i.code === "CSCE 221")) }));
    early[1] = { ...early[1]!, items: [...early[1]!.items, course("CSCE 221")] }; // Year 1 Spring
    const issue = run(early).prereqIssues.find((i) => i.code === "CSCE 221");
    expect(issue?.missing).toEqual([
      "one of CSCE 120, CSCE 121",
      "one of CSCE 222 (or same term), ECEN 222 (or same term)",
    ]);
  });

  it("5. a course outside the technical-elective list doesn't count", () => {
    const ev = run(swap(full, "ISEN 414", "PHIL 240"));
    expect(gaps(ev)).toEqual(["major.technical-elective:unmet"]);
  });
});
