import type { Course, Term } from "@plotted/engine";
import { describe, expect, it } from "vitest";
import { emptyTerms, type PlanState, reducer } from "./plan-state";

const course = (code: string): Course => ({
  code,
  subject: code.split(" ")[0]!,
  number: code.split(" ").at(-1)!,
  title: code,
  credits: 3,
  upperDivision: false,
  core: [],
});

const terms: Term[] = [
  { id: "y1-fall", label: "Year 1 · Fall", items: [{ kind: "course", id: "a", code: "C S 312" }] },
  {
    id: "y1-spring",
    label: "Year 1 · Spring",
    items: [{ kind: "slot", id: "s", label: "U.S. History (060)", credits: 3, filter: { core: ["060"] } }],
  },
];
const start: PlanState = { terms, extraCourses: [] };
const codes = (s: PlanState) => s.terms.map((t) => t.items.map((i) => (i.kind === "course" ? i.code : `[${i.label}]`)));

describe("plan reducer", () => {
  it("moves an item to another term, keeping its id", () => {
    const s = reducer(start, { type: "move", itemId: "a", toTermId: "y1-spring" });
    expect(codes(s)).toEqual([[], ["[U.S. History (060)]", "C S 312"]]);
    expect(s.terms[1]!.items[1]!.id).toBe("a");
  });

  it("ignores a move of an unknown item", () => {
    expect(reducer(start, { type: "move", itemId: "nope", toTermId: "y1-fall" })).toBe(start);
  });

  it("fills a slot with a course and remembers the course record", () => {
    const s = reducer(start, { type: "fill", slotId: "s", course: course("HIS 315K") });
    expect(codes(s)).toEqual([["C S 312"], ["HIS 315K"]]);
    expect(s.extraCourses.map((c) => c.code)).toEqual(["HIS 315K"]);
    // Adding the same course again doesn't duplicate the record.
    const s2 = reducer(s, { type: "add", termId: "y1-fall", course: course("HIS 315K") });
    expect(s2.extraCourses).toHaveLength(1);
  });

  it("adds a summer right after a spring, and the next regular semester at the end", () => {
    let s = reducer(start, { type: "addTerm", season: "Summer", afterTermId: "y1-spring" });
    s = reducer(s, { type: "addTerm", season: "Fall" });
    expect(s.terms.map((t) => t.label)).toEqual([
      "Year 1 · Fall",
      "Year 1 · Spring",
      "Year 1 · Summer",
      "Year 2 · Fall",
    ]);
  });

  it("only removes empty semesters", () => {
    expect(reducer(start, { type: "removeTerm", termId: "y1-fall" }).terms).toHaveLength(2);
    const emptied = reducer(start, { type: "remove", itemId: "a" });
    expect(reducer(emptied, { type: "removeTerm", termId: "y1-fall" }).terms.map((t) => t.id)).toEqual(["y1-spring"]);
  });

  it("starts empty plans with 8 semesters", () => {
    expect(emptyTerms().map((t) => t.label).slice(0, 3)).toEqual(["Year 1 · Fall", "Year 1 · Spring", "Year 2 · Fall"]);
    expect(emptyTerms()).toHaveLength(8);
  });

  it("v2: adds credit before college as the first column, then appends to it", () => {
    let s = reducer(start, { type: "addCredit", course: course("M 408C") });
    s = reducer(s, { type: "addCredit", course: course("C S 312") });
    expect(s.terms[0]).toMatchObject({ id: "credit", kind: "credit" });
    expect(codes(s)[0]).toEqual(["M 408C", "C S 312"]);
    expect(s.terms).toHaveLength(3);
  });

  it("v2: keeps the start term and credit across add, fill and reset", () => {
    let s = reducer(start, { type: "setStartTerm", startTerm: "Fall 2025" });
    s = reducer(s, { type: "addCredit", course: course("M 408C") });
    s = reducer(s, { type: "add", termId: "y1-fall", course: course("HIS 315K") });
    s = reducer(s, { type: "fill", slotId: "s", course: course("HIS 315L") });
    expect(s.startTerm).toBe("Fall 2025");
    s = reducer(s, { type: "reset", terms: emptyTerms() });
    expect(s.startTerm).toBe("Fall 2025");
    expect(s.terms[0]).toMatchObject({ kind: "credit" });
    expect(codes(s)[0]).toEqual(["M 408C"]);
    expect(s.extraCourses.map((c) => c.code)).toEqual(["M 408C"]); // only credit's records survive
    expect(s.terms).toHaveLength(9);
  });

  it("v2: a v1 plan (no start term, no credit) is untouched by v2 fields", () => {
    const s = reducer(start, { type: "move", itemId: "a", toTermId: "y1-spring" });
    expect(s.startTerm).toBeUndefined();
    expect(s.terms.some((t) => t.kind === "credit")).toBe(false);
  });

  it("v2: credit for a course already planned moves it out of its semester (no duplicate)", () => {
    const s = reducer(start, { type: "addCredit", course: course("C S 312") });
    expect(codes(s)).toEqual([["C S 312"], [], ["[U.S. History (060)]"]]);
    expect(s.terms[0]!.items[0]!.id).toBe("a"); // the same item, moved
  });
});
