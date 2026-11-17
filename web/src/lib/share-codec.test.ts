import type { Program, Term } from "@plotted/engine";
import { describe, expect, it } from "vitest";
import { decodePlan, encodePlan } from "./share-codec";

const slot = { kind: "slot" as const, id: "s1", label: "U.S. History (060)", credits: 3, filter: { core: ["060"] } };
const program = { suggestedPlan: [{ id: "y1", label: "Year 1 · Fall", items: [slot] }] } as unknown as Program;

const terms: Term[] = [
  { id: "a", label: "Year 1 · Fall", items: [{ kind: "course", id: "c1", code: "C S 312" }, slot] },
  { id: "b", label: "Year 1 · Spring", items: [{ kind: "slot", id: "s2", label: "Mystery elective", credits: 2, filter: { codes: ["X 1"] } }] },
  { id: "c", label: "Year 1 · Summer", items: [] },
];

describe("share codec", () => {
  it("round-trips terms, courses and slots (recovering slot filters from the program)", async () => {
    const enc = await encodePlan(terms);
    expect(enc).toMatch(/^1\.[A-Za-z0-9_-]+$/);
    const { terms: dec, startTerm } = await decodePlan(enc, program);
    expect(startTerm).toBeNull();
    expect(dec.map((t) => t.label)).toEqual(["Year 1 · Fall", "Year 1 · Spring", "Year 1 · Summer"]);
    expect(dec[0]!.items).toEqual([
      { kind: "course", id: "shared-0-0", code: "C S 312" },
      { kind: "slot", id: "shared-0-1", label: "U.S. History (060)", credits: 3, filter: { core: ["060"] } },
    ]);
    // Unknown slot labels fall back to "any course".
    expect(dec[1]!.items[0]).toMatchObject({ label: "Mystery elective", credits: 2, filter: { any: true } });
  });

  it("keeps a full 8-semester plan short enough for a link", async () => {
    const big: Term[] = Array.from({ length: 8 }, (_, i) => ({
      id: `t${i}`,
      label: `Year ${Math.floor(i / 2) + 1} · ${i % 2 ? "Spring" : "Fall"}`,
      items: Array.from({ length: 5 }, (_, j) => ({ kind: "course" as const, id: `${i}-${j}`, code: `C S 3${i}${j}` })),
    }));
    expect((await encodePlan(big)).length).toBeLessThan(600);
  });

  it("rejects garbage and unknown versions", async () => {
    await expect(decodePlan("2.abc", program)).rejects.toThrow();
    await expect(decodePlan("1.not-deflate", program)).rejects.toThrow();
  });

  it("v2: carries the start term and credit before college", async () => {
    const withCredit: Term[] = [
      { id: "credit", label: "Credit before college", kind: "credit", items: [{ kind: "course", id: "x", code: "M 408C" }] },
      ...terms,
    ];
    const { terms: dec, startTerm } = await decodePlan(await encodePlan(withCredit, "Fall 2025"), program);
    expect(startTerm).toBe("Fall 2025");
    expect(dec[0]).toMatchObject({ kind: "credit", items: [{ kind: "course", code: "M 408C" }] });
    expect(dec.slice(1).map((t) => t.label)).toEqual(["Year 1 · Fall", "Year 1 · Spring", "Year 1 · Summer"]);
  });
});
