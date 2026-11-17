import { analyzeSchedule, evaluate, type Program, type Term, termCalendar } from "@plotted/engine";
import { describe, expect, it } from "vitest";
import { loadProgram } from "../../../packages/engine/scripts/load";
import { answerFor } from "./answer";

const items = (terms: Term[]) => terms.reduce((n, t) => n + t.items.length, 0);

function answer(program: Program, courses: Parameters<typeof evaluate>[1], terms: Term[], start: string | null) {
  const ev = evaluate(program, courses, terms);
  const cal = termCalendar(terms, start, new Date(2025, 7, 20)); // first week of Fall 2025
  const s = analyzeSchedule(terms, courses);
  const last = terms[s.lastTerm];
  return answerFor({ ev, delays: s.delays, finish: last ? (cal.get(last.id)?.realLabel ?? last.label) : null, itemCount: items(terms) });
}

describe("answer line on real plans", () => {
  it("UT CS catalog plan: names the requirements the catalog leaves open", () => {
    const { program, courses } = loadProgram("ut-austin", "2026-28", "ut-cs-bs");
    const a = answer(program, courses, program.suggestedPlan, "Fall 2025");
    expect(a.tone).toBe("attention");
    expect(a.headline).toBe("3 requirements still open");
    expect(a.detail).toContain("last semester Spring 2029");
  });

  it("TAMU: moving MATH 151 to spring says graduation slips, with the chain", () => {
    const { program, courses } = loadProgram("tamu", "2026-27", "tamu-daen-bs");
    const moved = program.suggestedPlan.map((t, i) => ({
      ...t,
      items:
        i === 0
          ? t.items.filter((x) => !(x.kind === "course" && x.code === "MATH 151"))
          : i === 1
            ? [...t.items, { kind: "course" as const, id: "m151", code: "MATH 151" }]
            : t.items,
    }));
    const a = answer(program, courses, moved, "Fall 2026");
    expect(a.headline).toBe("Graduation slips past Spring 2030");
    expect(a.detail).toMatch(/^MATH 151 → … → DAEN 460 needs 7 more semesters after MATH 151; only 6 remain/);
    expect(a.focusItemId).toBe("m151");
  });

  it("a prerequisite problem leads when there's no delay", () => {
    const { program, courses } = loadProgram("ut-austin", "2026-28", "ut-cs-bs");
    const swapped = program.suggestedPlan.map((t, i) => ({
      ...t,
      items: i === 0 ? t.items.filter((x) => !(x.kind === "course" && x.code === "C S 312")) : t.items,
    }));
    const a = answer(program, courses, swapped, null);
    expect(a.tone).toBe("attention");
    expect(a.headline).toMatch(/comes? before (its|their) prerequisites/);
  });

  it("an empty plan says so instead of listing every requirement", () => {
    const { program, courses } = loadProgram("ut-austin", "2026-28", "ut-cs-bs");
    const empty = program.suggestedPlan.map((t) => ({ ...t, items: [] }));
    expect(answer(program, courses, empty, null)).toMatchObject({ tone: "empty", headline: "Nothing planned yet" });
  });
});
