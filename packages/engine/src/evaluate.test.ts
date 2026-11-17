import { describe, expect, it } from "vitest";
import { evaluate, improvements, openRequirementCodes } from "./evaluate";
import type { Course, Program, Term } from "./schema";

const c = (code: string, opts: Partial<Course> = {}): Course => {
  const [subject, number] = [code.slice(0, code.lastIndexOf(" ")), code.slice(code.lastIndexOf(" ") + 1)];
  return {
    code,
    subject,
    number,
    title: code,
    credits: Number(number[0]),
    upperDivision: Number(number.slice(1, 3)) >= 20,
    core: [],
    ...opts,
  };
};

const catalog = new Map(
  [
    c("C S 312"),
    c("C S 314", { prereq: { course: "C S 312" } }),
    c("C S 331", {
      prereq: { all: [{ course: "C S 314" }, { any: [{ course: "M 340L", concurrent: true }, { course: "M 341" }] }] },
    }),
    c("C S 439"),
    c("C S 373"),
    c("C S 378"),
    c("M 408C"),
    c("M 408N"),
    c("M 408S"),
    c("M 340L"),
    c("HIS 315K", { core: ["060"] }),
    c("HIS 315L", { core: ["060"] }),
  ].map((x) => [x.code, x]),
);

const program: Program = {
  id: "test",
  school: "test",
  catalogYear: "2026-28",
  name: "Test",
  degree: "BS",
  totalHours: 30,
  sourceUrl: "https://example.edu",
  scrapedAt: "2026-11-17",
  reviewNotes: [],
  suggestedPlan: [],
  areas: [
    {
      id: "conc",
      label: "Concentration",
      exclusive: true,
      rule: {
        type: "credits",
        id: "conc.ud",
        label: "6 hrs upper-division C S",
        hours: 6,
        filter: { subjects: ["C S"], upperDivision: true },
      },
    },
    {
      id: "major",
      label: "Major",
      exclusive: true,
      rule: {
        type: "allOf",
        id: "major",
        label: "Major",
        rules: [
          { type: "course", id: "m.312", code: "C S 312" },
          { type: "course", id: "m.331", code: "C S 331" },
          {
            type: "nOf",
            id: "m.calc",
            label: "Calculus sequence",
            n: 1,
            rules: [
              { type: "allOf", id: "s1", label: "Seq 1", rules: [{ type: "course", id: "s1.a", code: "M 408C" }] },
              {
                type: "allOf",
                id: "s2",
                label: "Seq 2",
                rules: [
                  { type: "course", id: "s2.a", code: "M 408N" },
                  { type: "course", id: "s2.b", code: "M 408S" },
                ],
              },
            ],
          },
          { type: "manual", id: "m.gpa", label: "2.0 GPA in major" },
        ],
      },
    },
    {
      id: "core",
      label: "Core",
      exclusive: false,
      rule: { type: "credits", id: "core.060", label: "US History", hours: 6, filter: { core: ["060"] } },
    },
  ],
};

const term = (id: string, ...codes: (string | { slot: string; credits: number; filter: object })[]): Term => ({
  id,
  label: id,
  items: codes.map((x, i) =>
    typeof x === "string"
      ? { kind: "course" as const, id: `${id}-${i}`, code: x }
      : { kind: "slot" as const, id: `${id}-${i}`, label: x.slot, credits: x.credits, filter: x.filter },
  ),
});

const area = (ev: ReturnType<typeof evaluate>, id: string) => ev.areas.find((a) => a.id === id)!.result;

describe("evaluate", () => {
  it("course rules claim courses before credit rules (no double counting across exclusive areas)", () => {
    const ev = evaluate(program, catalog, [
      term("t1", "C S 312", "M 408C"),
      term("t2", "C S 314", "M 340L"),
      term("t3", "C S 331", "C S 373"),
    ]);
    // C S 331 must go to the major's course rule, not the concentration's credits.
    expect(area(ev, "major").status).toBe("met");
    const conc = area(ev, "conc");
    expect(conc.hours).toEqual({ earned: 3, planned: 3, required: 6 });
    expect(conc.status).toBe("partial");
  });

  it("slots make a credit rule 'planned', not 'met'", () => {
    const ev = evaluate(program, catalog, [
      term("t1", "C S 312", "M 408C", "C S 373", { slot: "UD C S", credits: 3, filter: { subjects: ["C S"], upperDivision: true } }),
    ]);
    expect(area(ev, "conc").status).toBe("planned");
    expect(area(ev, "conc").hours).toEqual({ earned: 3, planned: 6, required: 6 });
  });

  it("picks the nOf child that the plan actually follows", () => {
    const ev = evaluate(program, catalog, [term("t1", "M 408N"), term("t2", "M 408S")]);
    const calc = area(ev, "major").children!.find((x) => x.id === "m.calc")!;
    expect(calc.status).toBe("met");
    expect(calc.itemIds).toEqual(["t1-0", "t2-0"]);
  });

  it("non-exclusive areas can reuse courses; core slots count as planned", () => {
    const ev = evaluate(program, catalog, [
      term("t1", "HIS 315K", { slot: "U.S. History (060)", credits: 3, filter: { core: ["060"] } }),
    ]);
    expect(area(ev, "core").status).toBe("planned");
  });

  it("manual rules don't block an otherwise-met allOf", () => {
    const ev = evaluate(program, catalog, [term("t1", "C S 312", "M 408C"), term("t2", "C S 314", "M 340L"), term("t3", "C S 331")]);
    const major = area(ev, "major");
    expect(major.children!.find((x) => x.id === "m.gpa")!.status).toBe("manual");
    expect(major.status).toBe("met");
  });

  it("fills rules that list specific courses before broad ones, regardless of order", () => {
    const p: Program = {
      ...program,
      areas: [
        {
          id: "conc",
          label: "Concentration",
          exclusive: true,
          rule: {
            type: "allOf",
            id: "conc",
            label: "Concentration",
            rules: [
              { type: "credits", id: "broad", label: "3 hrs any C S", hours: 3, filter: { subjects: ["C S"] } },
              { type: "credits", id: "list", label: "C S 373 or 378", hours: 3, filter: { codes: ["C S 373", "C S 378"] } },
            ],
          },
        },
      ],
    };
    const ev = evaluate(p, catalog, [term("t1", "C S 373", "C S 312")]);
    const kids = area(ev, "conc").children!;
    expect(kids.find((k) => k.id === "list")!.itemIds).toEqual(["t1-0"]);
    expect(kids.find((k) => k.id === "broad")!.itemIds).toEqual(["t1-1"]);
    expect(area(ev, "conc").status).toBe("met");
  });

  it("reports term and total credits, and unknown courses", () => {
    const ev = evaluate(program, catalog, [term("t1", "C S 312", "XYZ 301")]);
    expect(ev.termCredits).toEqual({ t1: 6 });
    expect(ev.unknownCourses).toEqual(["XYZ 301"]);
  });
});

describe("prerequisites", () => {
  it("flags a course scheduled before its prerequisite", () => {
    const ev = evaluate(program, catalog, [term("t1", "C S 314"), term("t2", "C S 312")]);
    expect(ev.prereqIssues).toEqual([{ itemId: "t1-0", code: "C S 314", termId: "t1", missing: ["C S 312"] }]);
  });

  it("allows concurrent enrollment where the catalog does", () => {
    const ev = evaluate(program, catalog, [term("t1", "C S 312"), term("t2", "C S 314"), term("t3", "C S 331", "M 340L")]);
    expect(ev.prereqIssues).toEqual([]);
  });

  it("explains which part of an and/or prereq is missing", () => {
    const ev = evaluate(program, catalog, [term("t1", "C S 331")]);
    expect(ev.prereqIssues[0]!.missing).toEqual(["C S 314", "one of M 340L (or same term), M 341"]);
  });
});

describe("cross-listed courses", () => {
  const xl = new Map(catalog);
  xl.set("STAT 315", c("STAT 315", { crossListed: ["CSCE 305", "ECEN 360"] }));
  xl.set("DAEN 300", c("DAEN 300", { prereq: { course: "ECEN 360" } }));

  it("satisfy a prerequisite written with another listing's code", () => {
    const ev = evaluate(program, xl, [term("t1", "STAT 315"), term("t2", "DAEN 300")]);
    expect(ev.prereqIssues).toEqual([]);
  });

  it("satisfy a course rule written with another listing's code", () => {
    const p: Program = {
      ...program,
      areas: [{ id: "m", label: "M", exclusive: true, rule: { type: "course", id: "m.x", code: "ECEN 360" } }],
    };
    expect(evaluate(p, xl, [term("t1", "STAT 315")]).areas[0]!.result.status).toBe("met");
  });
});

describe("suggestions", () => {
  it("lists codes from requirements that aren't met yet", () => {
    const ev = evaluate(program, catalog, [term("t1", "C S 312", "M 408C")]);
    const codes = openRequirementCodes(program, ev);
    expect(codes.has("C S 331")).toBe(true); // unmet course rule
    expect(codes.has("C S 312")).toBe(false); // already met
    expect(codes.has("M 408N")).toBe(false); // calc choice already met via Seq 1
  });

  it("reports a group when a course inside it is taken", () => {
    const before = evaluate(program, catalog, [term("t1", "C S 312")]);
    const after = evaluate(program, catalog, [term("t1", "C S 312", "M 408N")]);
    // M 408N starts calculus Sequence 2 (needs 408S too): the sequence moves to partial.
    expect(improvements(before, after)).toEqual([{ label: "Seq 2", status: "partial" }]);
  });

  it("reports the most specific rules a change improves", () => {
    const before = evaluate(program, catalog, [term("t1", "C S 312", "M 408C"), term("t2", "C S 314", "M 340L")]);
    const after = evaluate(program, catalog, [term("t1", "C S 312", "M 408C"), term("t2", "C S 314", "M 340L"), term("t3", "HIS 315K", "HIS 315L")]);
    expect(improvements(before, after)).toEqual([{ label: "US History", status: "met" }]);
  });
});
