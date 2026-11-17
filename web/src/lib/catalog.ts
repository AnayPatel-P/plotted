import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Catalog, Program, type Course, type Prereq, type Rule } from "@plotted/engine";

const DATA_DIR = path.join(process.cwd(), "..", "data");

async function readJson(rel: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(DATA_DIR, rel), "utf8"));
}

function ruleCodes(rule: Rule, out: Set<string>) {
  if (rule.type === "course") [rule.code, ...(rule.alternatives ?? [])].forEach((c) => out.add(c));
  if ("rules" in rule) rule.rules.forEach((r) => ruleCodes(r, out));
}

function prereqCodes(p: Prereq | undefined, out: Set<string>) {
  if (!p) return;
  if ("course" in p) out.add(p.course);
  else if ("all" in p) p.all.forEach((x) => prereqCodes(x, out));
  else if ("any" in p) p.any.forEach((x) => prereqCodes(x, out));
}

/**
 * Load a program and the slice of the catalog the page needs.
 * Phase 1 sends the courses the program and its plan mention, their prereqs,
 * plus every course that can fill a credit-hour rule (needed to evaluate).
 */
export async function loadProgram(school: string, year: string, programId: string) {
  "use cache";
  const program = Program.parse(await readJson(`${school}/${year}/programs/${programId}.json`));
  const catalog = Catalog.parse(await readJson(`${school}/${year}/courses.json`));

  const wanted = new Set<string>();
  program.areas.forEach((a) => ruleCodes(a.rule, wanted));
  program.suggestedPlan.forEach((t) =>
    t.items.forEach((i) => {
      if (i.kind === "course") [i.code, ...(i.alternatives ?? [])].forEach((c) => wanted.add(c));
    }),
  );
  const byCode = new Map(catalog.courses.map((c) => [c.code, c]));
  for (const code of [...wanted]) prereqCodes(byCode.get(code)?.prereq, wanted);

  const courses: Course[] = [...wanted].flatMap((c) => (byCode.has(c) ? [byCode.get(c)!] : []));
  return {
    program,
    courses,
    schoolName: catalog.schoolName,
    catalogSize: catalog.courses.length,
  };
}
