import { describe, expect, it } from "vitest";
import { currentRealTerm, firstChangeableIndex, realTermFor, termCalendar } from "./calendar";
import { evaluate } from "./evaluate";
import { analyzeSchedule } from "./schedule";
import type { Course, Program, Term } from "./schema";

const t = (label: string, codes: string[] = [], kind?: "credit"): Term => ({
  id: label,
  label,
  kind,
  items: codes.map((code, i) => ({ kind: "course" as const, id: `${label}-${i}`, code })),
});

describe("calendar", () => {
  it("maps Year/Season labels to real terms from a fall start", () => {
    const start = { season: "Fall" as const, year: 2025 };
    expect(realTermFor("Year 1 · Fall", start)).toEqual({ season: "Fall", year: 2025 });
    expect(realTermFor("Year 1 · Spring", start)).toEqual({ season: "Spring", year: 2026 });
    expect(realTermFor("Year 1 · Summer", start)).toEqual({ season: "Summer", year: 2026 });
    expect(realTermFor("Year 4 · Spring", start)).toEqual({ season: "Spring", year: 2029 });
  });

  it("handles a spring start (academic year began the previous fall)", () => {
    expect(realTermFor("Year 1 · Spring", { season: "Spring", year: 2026 })).toEqual({ season: "Spring", year: 2026 });
    expect(realTermFor("Year 2 · Fall", { season: "Spring", year: 2026 })).toEqual({ season: "Fall", year: 2026 });
  });

  it("knows the current term from a date", () => {
    expect(currentRealTerm(new Date(2026, 10, 17))).toEqual({ season: "Fall", year: 2026 });
    expect(currentRealTerm(new Date(2027, 1, 1))).toEqual({ season: "Spring", year: 2027 });
    expect(currentRealTerm(new Date(2027, 5, 15))).toEqual({ season: "Summer", year: 2027 });
  });

  it("marks completed / in progress / future and skips credit", () => {
    const terms = [t("Credit before college", [], "credit"), t("Year 1 · Fall"), t("Year 1 · Spring"), t("Year 2 · Fall"), t("Year 2 · Spring")];
    const cal = termCalendar(terms, "Fall 2025", new Date(2026, 10, 17)); // November 2026
    expect([...cal.values()].map((i) => [i.realLabel ?? i.kind, i.status])).toEqual([
      ["credit", undefined],
      ["Fall 2025", "completed"],
      ["Spring 2026", "completed"],
      ["Fall 2026", "in-progress"],
      ["Spring 2027", "future"],
    ]);
    expect(firstChangeableIndex(terms, cal)).toBe(3);
  });

  it("leaves plans without a start term unchanged (v1 plans)", () => {
    const cal = termCalendar([t("Year 1 · Fall")], null, new Date(2026, 10, 17));
    expect(cal.get("Year 1 · Fall")).toEqual({ kind: "semester" });
  });
});

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
const courses = new Map(
  [c("A 1"), c("A 2", { course: "A 1" }), c("A 3", { course: "A 2" }), c("A 4", { course: "A 3" })].map((x) => [x.code, x]),
);
const program = {
  areas: [{ id: "m", label: "M", exclusive: true, rule: { type: "credits", id: "h", label: "6 hrs", hours: 6, filter: { any: true } } }],
} as unknown as Program;

describe("credit before college", () => {
  const terms = [t("Credit", ["A 1"], "credit"), t("Year 1 · Fall", ["A 2"]), t("Year 1 · Spring", ["A 3"]), t("Year 2 · Fall", ["A 4"])];

  it("satisfies prerequisites and counts toward requirements", () => {
    const ev = evaluate(program, courses, terms);
    expect(ev.prereqIssues).toEqual([]);
    expect(ev.areas[0]!.result.status).toBe("met");
  });

  it("doesn't use up a semester or get warnings of its own", () => {
    const s = analyzeSchedule(terms, courses);
    expect(s.items.get("Credit-0")!.tail).toBe(2); // A 1 → A 2 is free; A 2 → A 3 → A 4 costs 2
    expect(s.items.get("Credit-0")!.critical).toBe(false);
    expect(s.delays).toEqual([]);
  });

  it("an empty credit column doesn't count as the last semester", () => {
    const s = analyzeSchedule([t("Year 1 · Fall", ["A 1"]), t("Credit", [], "credit")], courses);
    expect(s.lastTerm).toBe(0);
  });
});

describe("completed semesters are fixed", () => {
  it("no delay warnings or no-slack marks before the first changeable term", () => {
    // A 1 sits in the last (completed) term with its chain after it: normally a delay.
    const terms = [t("Year 1 · Fall", ["A 2"]), t("Year 1 · Spring", ["A 1", "A 3"]), t("Year 2 · Fall", ["A 4"])];
    expect(analyzeSchedule(terms, courses).delays.map((d) => d.code)).toEqual(["A 1"]);
    const fixed = analyzeSchedule(terms, courses, { changeableFrom: 2 });
    expect(fixed.delays).toEqual([]);
    expect(fixed.items.get("Year 1 · Spring-0")!.critical).toBe(false);
  });
});
