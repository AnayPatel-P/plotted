import { describe, expect, it } from "vitest";
import { editions, loadCourses, loadPrograms } from "../scripts/load";
import { evaluate } from "./evaluate";
import { requirementSkeleton } from "./skeleton";

describe("requirement skeleton (a cleared plan)", () => {
  for (const ed of editions()) {
    const courses = loadCourses(ed);
    for (const program of loadPrograms(ed)) {
      it(`${program.id}: every course becomes a placeholder that keeps the plan's coverage`, () => {
        const skeleton = requirementSkeleton(program, courses);
        const items = skeleton.flatMap((t) => t.items);
        expect(items.filter((i) => i.kind === "course")).toEqual([]);
        expect(items.length).toBe(program.suggestedPlan.flatMap((t) => t.items).length);

        const before = evaluate(program, courses, program.suggestedPlan).areas;
        const after = evaluate(program, courses, skeleton).areas;
        after.forEach((a, i) => {
          const was = before[i]!.result.status;
          // Nothing is chosen yet, so "met" becomes "planned" — but nothing gets worse than that.
          expect([was, was === "met" ? "planned" : was]).toContain(a.result.status);
        });
      });
    }
  }

  it("a placeholder for a required course counts as planned for it", () => {
    const ed = editions().find((e) => e.school === "ut-austin")!;
    const courses = loadCourses(ed);
    const cs = loadPrograms(ed).find((p) => p.id === "ut-cs-bs")!;
    const slot = requirementSkeleton(cs, courses)[0]!.items.find((i) => i.kind === "slot" && i.label === "C S 312 or C S 312H");
    expect(slot).toMatchObject({ filter: { codes: ["C S 312", "C S 312H"] } });
  });
});
