import { describe, expect, it } from "vitest";
import { analyzeSchedule } from "./schedule";
import type { Course, Term } from "./schema";

const c = (code: string, prereq?: Course["prereq"]): Course => ({
  code,
  subject: code.split(" ")[0]!,
  number: code.split(" ").at(-1)!,
  title: code,
  credits: 3,
  upperDivision: false,
  core: [],
  prereq,
});
// A 1 -> A 2 -> A 3 -> A 4 chain, plus B 1 (same term OK) feeding A 3, plus loose X 1.
const courses = new Map(
  [
    c("A 1"),
    c("A 2", { course: "A 1" }),
    c("A 3", { all: [{ course: "A 2" }, { course: "B 1", concurrent: true }] }),
    c("A 4", { course: "A 3" }),
    c("B 1"),
    c("X 1"),
  ].map((x) => [x.code, x]),
);
const plan = (...terms: string[][]): Term[] =>
  terms.map((codes, i) => ({
    id: `t${i}`,
    label: `t${i}`,
    items: codes.map((code) => ({ kind: "course" as const, id: code.replace(" ", ""), code })),
  }));

describe("analyzeSchedule", () => {
  it("computes chain lengths, slack and the critical path", () => {
    const s = analyzeSchedule(plan(["A 1", "X 1"], ["A 2"], ["A 3", "B 1"], [], ["A 4"]), courses);
    expect(s.lastTerm).toBe(4);
    const a1 = s.items.get("A1")!;
    expect([a1.tail, a1.depth, a1.slack]).toEqual([3, 0, 1]);
    expect(a1.chain).toEqual(["A 1", "A 2", "A 3", "A 4"]);
    expect(s.items.get("B1")!.tail).toBe(1); // B 1 -> A 3 (same term) -> A 4
    expect(s.items.get("A4")!.critical).toBe(true); // in the last term, end of a chain
    expect(s.items.get("X1")!.critical).toBe(false);
    expect(s.longestChain).toEqual(["A1", "A2", "A3", "A4"]);
    expect(s.delays).toEqual([]);
  });

  it("warns once, at the head of a chain pushed past the last term", () => {
    // A 1 moved to term 2: A 2, A 3, A 4 now need 3 more terms but only 2 remain.
    const s = analyzeSchedule(plan(["X 1"], ["A 2"], ["A 1", "B 1"], ["A 3"], ["A 4"]), courses);
    expect(s.delays).toEqual([
      { itemId: "A1", code: "A 1", chain: ["A 1", "A 2", "A 3", "A 4"], termsNeeded: 3, termsLeft: 2 },
    ]);
    expect(s.items.get("A1")!.slack).toBe(-1);
  });

  it("returns no chain for a plan without prerequisites", () => {
    const s = analyzeSchedule(plan(["X 1"], ["B 1"]), courses);
    expect(s.longestChain).toEqual([]);
    expect([...s.items.values()].some((i) => i.critical)).toBe(false);
  });
});
