/**
 * Share links: the whole plan is packed into the URL fragment (#p=…), which
 * browsers never send to a server — sharing stores and logs nothing.
 *
 * Format: JSON → deflate-raw → base64url, prefixed with a version.
 *   { v: 1, t: [[termLabel, [item, …]], …] }
 *   item = "C S 312" (course) | [slotLabel, credits] (placeholder)
 * Placeholder filters are recovered by label from the program's suggested plan
 * and its requirement skeleton (unknown labels accept any course).
 */
import type { PlanItem, PlanSlot, Program, Term } from "@plotted/engine";
import { z } from "zod";

const Item = z.union([
  z.string().max(20),
  z.tuple([z.string().max(200), z.number()]),
]);
const Packed = z.object({
  v: z.literal(1),
  /** v2: start term, e.g. "Fall 2025". */
  s: z
    .string()
    .regex(/^(Spring|Summer|Fall) \d{4}$/)
    .optional(),
  /** v2: credit before college. */
  c: z.array(Item).max(60).optional(),
  t: z
    .array(
      z.tuple([
        z.string().max(40),
        z
          .array(
            z.union([
              z.string().max(20),
              z.tuple([z.string().max(200), z.number()]),
            ]),
          )
          .max(30),
      ]),
    )
    .max(24),
});

const toB64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );

async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const packItems = (items: PlanItem[]) =>
  items.map((i) =>
    i.kind === "course" ? i.code : ([i.label, i.credits] as [string, number]),
  );

export async function encodePlan(
  terms: Term[],
  startTerm?: string | null,
): Promise<string> {
  const credit = terms.find((t) => t.kind === "credit");
  const packed: z.infer<typeof Packed> = {
    v: 1,
    ...(startTerm ? { s: startTerm } : {}),
    ...(credit?.items.length ? { c: packItems(credit.items) } : {}),
    t: terms
      .filter((t) => t.kind !== "credit")
      .map((t) => [t.label, packItems(t.items)]),
  };
  const raw = new TextEncoder().encode(JSON.stringify(packed));
  return `1.${toB64url(await pipe(raw, new CompressionStream("deflate-raw")))}`;
}

export async function decodePlan(
  encoded: string,
  program: Program,
  /** More known placeholders, e.g. the requirement skeleton's. */
  templates: PlanSlot[] = [],
): Promise<{ terms: Term[]; startTerm: string | null }> {
  const [version, body] = encoded.split(".", 2);
  if (version !== "1" || !body || body.length > 8000)
    throw new Error("Unsupported share link");
  const raw = await pipe(
    fromB64url(body),
    new DecompressionStream("deflate-raw"),
  );
  if (raw.length > 64_000) throw new Error("Share link too large");
  const packed = Packed.parse(JSON.parse(new TextDecoder().decode(raw)));

  const known = new Map<string, PlanSlot>();
  templates.forEach((slot) => known.set(slot.label, slot));
  program.suggestedPlan.forEach((t) =>
    t.items.forEach((i) => i.kind === "slot" && known.set(i.label, i)),
  );

  const unpack = (items: z.infer<typeof Item>[], prefix: string) =>
    items.map((x, ii): PlanItem => {
      const id = `${prefix}-${ii}`;
      return typeof x === "string"
        ? { kind: "course", id, code: x }
        : (() => {
            const t = known.get(x[0]);
            return {
              kind: "slot",
              id,
              label: x[0],
              credits: x[1],
              filter: t?.filter ?? { any: true },
              ...(t?.for ? { for: t.for } : {}),
              ...(t?.counts ? { counts: t.counts } : {}),
            };
          })();
    });
  const terms: Term[] = packed.t.map(([label, items], ti) => ({
    id: `shared-${ti}`,
    label,
    items: unpack(items, `shared-${ti}`),
  }));
  if (packed.c?.length) {
    terms.unshift({
      id: "credit",
      label: "Credit before college",
      kind: "credit",
      items: unpack(packed.c, "shared-credit"),
    });
  }
  return { terms, startTerm: packed.s ?? null };
}
