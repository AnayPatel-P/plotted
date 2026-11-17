import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Course, Program, type Prereq, type Rule } from "@plotted/engine";
import { z } from "zod";

const DATA_DIR = path.join(process.cwd(), "..", "data");

const CourseIndex = z.object({
  school: z.string(),
  schoolName: z.string(),
  catalogYear: z.string(),
  subjects: z.array(z.object({ code: z.string(), file: z.string(), count: z.number() })),
});

async function readJson(rel: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(DATA_DIR, rel), "utf8"));
}

function ruleCodes(rule: Rule, out: Set<string>) {
  if (rule.type === "course") [rule.code, ...(rule.alternatives ?? [])].forEach((c) => out.add(c));
  if (rule.type === "credits") rule.filter.codes?.forEach((c) => out.add(c));
  if ("rules" in rule) rule.rules.forEach((r) => ruleCodes(r, out));
}

function prereqCodes(p: Prereq | undefined, out: Set<string>) {
  if (!p) return;
  if ("course" in p) out.add(p.course);
  else if ("all" in p) p.all.forEach((x) => prereqCodes(x, out));
  else if ("any" in p) p.any.forEach((x) => prereqCodes(x, out));
}

const subjectOf = (code: string) => code.slice(0, code.lastIndexOf(" "));

/**
 * Load a program and the slice of the catalog its page needs: courses the
 * program and its plan name, plus their prerequisites. Only the subject files
 * those courses live in are read.
 */
export async function loadProgram(school: string, year: string, programId: string) {
  "use cache";
  const base = `${school}/${year}`;
  const program = Program.parse(await readJson(`${base}/programs/${programId}.json`));
  const index = CourseIndex.parse(await readJson(`${base}/courses/index.json`));
  const files = new Map(index.subjects.map((s) => [s.code, s.file]));

  const loaded = new Map<string, Course>();
  const loadedSubjects = new Set<string>();
  async function ensure(codes: Iterable<string>) {
    const subjects = new Set([...codes].map(subjectOf).filter((s) => files.has(s) && !loadedSubjects.has(s)));
    await Promise.all(
      [...subjects].map(async (s) => {
        loadedSubjects.add(s);
        const list = Course.array().parse(await readJson(`${base}/courses/${files.get(s)}`));
        list.forEach((c) => loaded.set(c.code, c));
      }),
    );
  }

  const wanted = new Set<string>();
  program.areas.forEach((a) => ruleCodes(a.rule, wanted));
  program.suggestedPlan.forEach((t) =>
    t.items.forEach((i) => {
      if (i.kind === "course") [i.code, ...(i.alternatives ?? [])].forEach((c) => wanted.add(c));
    }),
  );
  await ensure(wanted);
  for (const code of [...wanted]) prereqCodes(loaded.get(code)?.prereq, wanted);
  await ensure(wanted);

  const courses = [...wanted].flatMap((c) => (loaded.has(c) ? [loaded.get(c)!] : []));
  return {
    program,
    courses,
    schoolName: index.schoolName,
    catalogSize: index.subjects.reduce((s, x) => s + x.count, 0),
  };
}

export interface ProgramSummary {
  school: string;
  schoolName: string;
  year: string;
  id: string;
  name: string;
  degree: string;
}

/** Every program in data/, for the home page and static params. */
export async function listPrograms(): Promise<ProgramSummary[]> {
  "use cache";
  const { readdir } = await import("node:fs/promises");
  const out: ProgramSummary[] = [];
  for (const school of await readdir(DATA_DIR)) {
    for (const year of await readdir(path.join(DATA_DIR, school))) {
      let files: string[];
      try {
        files = await readdir(path.join(DATA_DIR, school, year, "programs"));
      } catch {
        continue;
      }
      const index = CourseIndex.parse(await readJson(`${school}/${year}/courses/index.json`));
      for (const f of files.filter((f) => f.endsWith(".json"))) {
        const p = Program.parse(await readJson(`${school}/${year}/programs/${f}`));
        out.push({ school, schoolName: index.schoolName, year, id: p.id, name: p.name, degree: p.degree });
      }
    }
  }
  return out.sort((a, b) => a.schoolName.localeCompare(b.schoolName) || a.name.localeCompare(b.name));
}
