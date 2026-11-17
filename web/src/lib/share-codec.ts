/**
 * Share links: the whole plan is packed into the URL fragment (#p=…), which
 * browsers never send to a server — sharing stores and logs nothing.
 *
 * Format: JSON → deflate-raw → base64url, prefixed with a version.
 *   { v: 1, t: [[termLabel, [item, …]], …] }
 *   item = "C S 312" (course) | [slotLabel, credits] (placeholder)
 * Placeholder filters are recovered from the program's suggested plan by
 * label (unknown labels accept any course).
 */
import type { CourseFilter, PlanItem, Program, Term } from "@plotted/engine";
import { z } from "zod";

const Packed = z.object({
  v: z.literal(1),
  t: z
    .array(z.tuple([z.string().max(40), z.array(z.union([z.string().max(20), z.tuple([z.string().max(200), z.number()])])).max(30)]))
    .max(24),
});

const toB64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodePlan(terms: Term[]): Promise<string> {
  const packed: z.infer<typeof Packed> = {
    v: 1,
    t: terms.map((t) => [t.label, t.items.map((i) => (i.kind === "course" ? i.code : ([i.label, i.credits] as [string, number])))]),
  };
  const raw = new TextEncoder().encode(JSON.stringify(packed));
  return `1.${toB64url(await pipe(raw, new CompressionStream("deflate-raw")))}`;
}

export async function decodePlan(encoded: string, program: Program): Promise<Term[]> {
  const [version, body] = encoded.split(".", 2);
  if (version !== "1" || !body || body.length > 8000) throw new Error("Unsupported share link");
  const raw = await pipe(fromB64url(body), new DecompressionStream("deflate-raw"));
  if (raw.length > 64_000) throw new Error("Share link too large");
  const packed = Packed.parse(JSON.parse(new TextDecoder().decode(raw)));

  const filters = new Map<string, CourseFilter>();
  program.suggestedPlan.forEach((t) => t.items.forEach((i) => i.kind === "slot" && filters.set(i.label, i.filter)));

  return packed.t.map(([label, items], ti) => ({
    id: `shared-${ti}`,
    label,
    items: items.map((x, ii): PlanItem => {
      const id = `shared-${ti}-${ii}`;
      return typeof x === "string"
        ? { kind: "course", id, code: x }
        : { kind: "slot", id, label: x[0], credits: x[1], filter: filters.get(x[0]) ?? { any: true } };
    }),
  }));
}
