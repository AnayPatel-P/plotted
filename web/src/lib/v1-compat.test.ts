/**
 * Plans created before v2 must keep working: browser storage, account rows and
 * share links all lack v2 fields (startTerm, credit column).
 */
import type { Program } from "@plotted/engine";
import { Term } from "@plotted/engine";
import { describe, expect, it } from "vitest";
import { loadSaved, reducer, save } from "./plan-state";
import { decodePlan } from "./share-codec";

// A real share link produced by v1 (Phase 6) for the TAMU Data Engineering suggested plan.
const V1_LINK =
  "1.pZJPS8NAEMW_yjDnHHZn0_TPrcRoBdOKiYdScihhsYGYyDYpiPi5vPvJZLZpN0bBgrdHduf33pvsGx5wJj1scLbZ4FpvDUj4_IDrbVmit8FwEcUgxRi9TkqW0fLmDqRQR_kAUhB6GM_TBciR5LnHqjhosy-aVwhroyFsjSnytmyf0VNZlnl9s-TFFNUTj1kaycDRGHy_WCdAIvgbzIl3db3XUFd6BsfIJKA2cGki-lY_CSMGcH2WRHTqTHYTNiVx51NK_pqk8xRIShxgXdGOxnNX82gJJNkjCldLILdMJfyTsxKjHk39CKkswLKUcNI5KMXyNrEXeg6TIdaF7GgOQcrJyTnZcT2rOAbiJ3H5z_f7LSzWd9F9mp7lyEkaX_QK7OVU57uqyLclRKXOm-Kg7WnXYDrFQZRBcz8Q__MK-PT3EFmWvX8B";

const program = { suggestedPlan: [] } as unknown as Program;

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

describe("v1 compatibility", () => {
  it("decodes a v1 share link: same semesters, no start term, no credit column", async () => {
    const { terms, startTerm } = await decodePlan(V1_LINK.slice(0), program);
    expect(startTerm).toBeNull();
    expect(terms.some((t) => t.kind === "credit")).toBe(false);
    expect(terms.map((t) => t.label)).toEqual([
      "Year 1 · Fall",
      "Year 1 · Spring",
      "Year 2 · Fall",
      "Year 2 · Spring",
      "Year 3 · Fall",
      "Year 3 · Spring",
      "Year 4 · Fall",
      "Year 4 · Spring",
    ]);
    expect(terms[0]!.items.find((i) => i.kind === "course")).toMatchObject({ code: "CHEM 107" });
  });

  it("loads a v1 browser-saved plan and keeps working through v2 actions", () => {
    const storage = new MemoryStorage();
    (globalThis as unknown as { window: { localStorage: MemoryStorage } }).window = { localStorage: storage };
    const v1Saved = {
      v: 1,
      terms: [{ id: "y1-fall", label: "Year 1 · Fall", items: [{ kind: "course", id: "a", code: "C S 312" }] }],
      extraCourses: [],
      savedAt: "2026-11-10T00:00:00.000Z",
      remoteId: null,
    };
    storage.setItem("k", JSON.stringify(v1Saved));
    const loaded = loadSaved("k")!;
    expect(loaded.terms).toHaveLength(1);
    expect(loaded.startTerm).toBeUndefined();

    const next = reducer({ terms: loaded.terms, extraCourses: [] }, { type: "setStartTerm", startTerm: "Fall 2025" });
    save("k", next);
    expect(loadSaved("k")!.startTerm).toBe("Fall 2025");
  });

  it("v1 account rows (terms without kind) parse with the v2 schema", () => {
    const v1Row = [{ id: "y1-fall", label: "Year 1 · Fall", items: [{ kind: "course", id: "a", code: "C S 312" }] }];
    expect(Term.array().safeParse(v1Row).success).toBe(true);
  });
});
