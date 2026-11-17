/** Node-side loading of catalog data from the repo's data/ directory (scripts and tests). */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Course, Program } from "../src/schema";

export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../data");

export interface Edition {
  school: string;
  year: string;
  dir: string;
}

export function editions(): Edition[] {
  return readdirSync(DATA_DIR).flatMap((school) =>
    readdirSync(path.join(DATA_DIR, school))
      .filter((year) => existsSync(path.join(DATA_DIR, school, year, "courses", "index.json")))
      .map((year) => ({ school, year, dir: path.join(DATA_DIR, school, year) })),
  );
}

export function loadCourses(ed: Edition): Map<string, Course> {
  const index = JSON.parse(readFileSync(path.join(ed.dir, "courses", "index.json"), "utf8")) as {
    subjects: { file: string }[];
  };
  const out = new Map<string, Course>();
  for (const s of index.subjects) {
    const list = Course.array().parse(JSON.parse(readFileSync(path.join(ed.dir, "courses", s.file), "utf8")));
    for (const c of list) out.set(c.code, c);
  }
  return out;
}

export function loadPrograms(ed: Edition): Program[] {
  const dir = path.join(ed.dir, "programs");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => Program.parse(JSON.parse(readFileSync(path.join(dir, f), "utf8"))));
}

export function loadProgram(school: string, year: string, id: string) {
  const ed = { school, year, dir: path.join(DATA_DIR, school, year) };
  const program = loadPrograms(ed).find((p) => p.id === id);
  if (!program) throw new Error(`no program ${id} in ${school}/${year}`);
  return { program, courses: loadCourses(ed) };
}
