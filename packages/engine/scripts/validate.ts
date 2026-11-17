/**
 * npm run validate
 *
 * For every school/catalog year in data/: schema-check courses and programs,
 * check that every course a rule or plan names exists and every prereq points
 * at a real course, then evaluate each program's suggested plan and print what
 * it leaves unmet. Exits non-zero on schema errors or dangling references.
 */
import { evaluate, type RuleResult } from "../src/evaluate";
import type { Prereq, Rule } from "../src/schema";
import { editions, loadCourses, loadOfferings, loadPrograms } from "./load";

let errors = 0;
const fail = (msg: string) => {
  errors++;
  console.log(`  ✗ ${msg}`);
};

/** Primary course codes (must exist) and optional codes (alternatives, list entries). */
function ruleCodes(r: Rule): { required: string[]; optional: string[] } {
  if (r.type === "course") return { required: [r.code], optional: r.alternatives ?? [] };
  if (r.type === "credits") return { required: [], optional: r.filter.codes ?? [] };
  if (r.type === "allOf" || r.type === "nOf") {
    const kids = r.rules.map(ruleCodes);
    return { required: kids.flatMap((k) => k.required), optional: kids.flatMap((k) => k.optional) };
  }
  return { required: [], optional: [] };
}

function prereqCodes(p: Prereq): string[] {
  if ("course" in p) return [p.course];
  if ("all" in p) return p.all.flatMap(prereqCodes);
  if ("any" in p) return p.any.flatMap(prereqCodes);
  return [];
}

function unmet(r: RuleResult, path: string[] = []): string[] {
  const here = [...path, r.label];
  if (r.status === "met" || r.status === "manual") return [];
  if (r.type === "nOf" && r.status === "planned") return [];
  if (r.children?.length) {
    const kids = r.children.flatMap((c) => unmet(c, here));
    if (kids.length) return kids;
  }
  const extra = r.hours ? ` (${r.hours.earned} earned + ${r.hours.planned - r.hours.earned} in slots / ${r.hours.required})` : "";
  return [`${r.status.padEnd(8)} ${here.slice(1).join(" › ")}${extra}`];
}

for (const ed of editions()) {
  console.log(`\n${ed.school} ${ed.year}`);
  const courses = loadCourses(ed);
  console.log(`  ${courses.size} courses`);

  let dangling = 0;
  for (const c of courses.values()) {
    for (const code of c.prereq ? prereqCodes(c.prereq) : []) if (!courses.has(code)) dangling++;
  }
  // Prereqs may name retired or graduate courses; report, don't fail.
  console.log(`  ${dangling} prerequisite references point at courses not in this catalog (retired/graduate)`);

  const offerings = loadOfferings(ed);
  if (offerings) {
    const pct = Math.round((100 * offerings.coverage.seen) / offerings.coverage.named);
    console.log(
      `  offerings: ${Object.keys(offerings.courses).length} courses over ${offerings.terms.length} terms (${offerings.terms[0]} – ${offerings.terms.at(-1)}); ${pct}% of program courses seen`,
    );
    if (pct < 80) fail(`offering coverage ${pct}% is below the 80% target`);
  } else console.log("  offerings: none");

  for (const program of loadPrograms(ed)) {
    console.log(`\n  ${program.id}: ${program.name} (${program.degree})`);
    for (const area of program.areas) {
      const { required, optional } = ruleCodes(area.rule);
      for (const code of required) if (!courses.has(code)) fail(`${area.id} requires unknown course ${code}`);
      const missingOptional = [...new Set(optional.filter((c) => !courses.has(c)))];
      if (missingOptional.length)
        console.log(`    note: options not in this catalog (ignored): ${missingOptional.join(", ")}`);
    }
    for (const t of program.suggestedPlan) {
      for (const i of t.items) if (i.kind === "course" && !courses.has(i.code)) fail(`plan names unknown course ${i.code}`);
    }
    const ev = evaluate(program, courses, program.suggestedPlan);
    console.log(`    suggested plan: ${ev.totalCredits} hours / ${program.totalHours}`);
    for (const a of ev.areas) console.log(`    ${a.result.status.padEnd(8)} ${a.label}`);
    const gaps = ev.areas.flatMap((a) => unmet(a.result).map((u) => `${a.label} › ${u}`));
    for (const g of gaps) console.log(`      - ${g}`);
    for (const i of ev.prereqIssues) console.log(`      ! prereq: ${i.code} in ${i.termId} needs ${i.missing.join("; ")}`);
    if (offerings) {
      for (const t of program.suggestedPlan) {
        const season = t.label.split(" · ")[1];
        for (const i of t.items) {
          if (i.kind !== "course") continue;
          const options = [i.code, ...(i.alternatives ?? [])];
          const o = offerings.courses[i.code];
          if (!o && options.some((c) => offerings.courses[c])) continue; // an alternative runs
          if (!o) console.log(`      ? offering: ${i.code} (${t.label}) not offered ${offerings.terms[0]} – ${offerings.terms.at(-1)}`);
          else if ((o.pattern === "fall" || o.pattern === "spring") && o.confidence !== "low" && o.pattern !== season?.toLowerCase())
            console.log(`      ? offering: ${i.code} in ${t.label}, but recently ${o.pattern} only (${o.confidence})`);
        }
      }
    }
    if (ev.unknownCourses.length) fail(`unknown courses in plan: ${ev.unknownCourses.join(", ")}`);
  }
}

if (errors) {
  console.log(`\n${errors} error(s)`);
  process.exit(1);
}
console.log("\nOK");
