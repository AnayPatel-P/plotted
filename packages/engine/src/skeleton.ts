/**
 * A requirement skeleton: the catalog's suggested plan with every course turned
 * into a placeholder for the requirement it fills ("C S 312 or C S 312H",
 * "Natural science sequence", "Upper-division C S"). It's what a cleared plan
 * starts from — the shape of the degree, with nothing chosen yet.
 */
import { evaluate, type RuleResult } from "./evaluate";
import type { Course, CourseFilter, PlanItem, Program, Rule, Term } from "./schema";

const ELECTIVE: CourseFilter = { any: true };

function courseCodes(rule: Rule): string[] {
  if (rule.type === "course") return [rule.code, ...(rule.alternatives ?? [])];
  if (rule.type === "allOf" || rule.type === "nOf") return rule.rules.flatMap(courseCodes);
  return [];
}

/** Some catalog labels only make sense next to their list ("Hours from list"): name the courses. */
function creditLabel(label: string, filter: CourseFilter): string {
  const codes = filter.codes ?? [];
  const generic = /^(hours from (the )?list|upper-division coursework)$/i.test(label.trim());
  if (generic && codes.length) {
    return codes.length <= 3 ? codes.join(" or ") : `${codes[0]}, ${codes[1]} or ${codes.length - 2} more`;
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function requirementSkeleton(
  program: Program,
  courses: Map<string, Course>,
  terms: Term[] = program.suggestedPlan,
): Term[] {
  const rules = new Map<string, Rule>();
  const parent = new Map<string, string>();
  const exclusive = new Map<string, boolean>();
  const walk = (r: Rule, area: boolean, up?: string) => {
    rules.set(r.id, r);
    exclusive.set(r.id, area);
    if (up) parent.set(r.id, up);
    if (r.type === "allOf" || r.type === "nOf") r.rules.forEach((c) => walk(c, area, r.id));
  };
  program.areas.forEach((a) => walk(a.rule, a.exclusive));

  // Which requirement each planned course fills. Specific beats general:
  // a course rule, then a credit rule in the major, then one elsewhere (core, totals).
  const ev = evaluate(program, courses, terms);
  const rank = (id: string) => (rules.get(id)?.type === "course" ? 0 : exclusive.get(id) ? 1 : 2);
  const fills = new Map<string, string>();
  const visit = (r: RuleResult) => {
    if (r.children) return r.children.forEach(visit);
    for (const item of r.itemIds) {
      const had = fills.get(item);
      if (had === undefined || rank(r.id) < rank(had)) fills.set(item, r.id);
    }
  };
  ev.areas.forEach((a) => visit(a.result));

  const placeholder = (item: Extract<PlanItem, { kind: "course" }>): PlanItem => {
    const credits = courses.get(item.code)?.credits ?? 3;
    const suggested = courses.get(item.code);
    const c = suggested && {
      ...(suggested.core.length ? { core: suggested.core } : {}),
      ...(suggested.upperDivision ? { upperDivision: true } : {}),
    };
    const counts = c && Object.keys(c).length ? { counts: c } : {};
    const rule = rules.get(fills.get(item.id) ?? "");
    if (rule?.type === "course") {
      // Inside a choice ("one sequence from …"), the placeholder stands for the whole choice.
      let choice: Rule | undefined;
      for (let up = parent.get(rule.id); up && !choice; up = parent.get(up)) {
        if (rules.get(up)?.type === "nOf") choice = rules.get(up);
      }
      const target = choice ?? rule;
      const codes = [...new Set(courseCodes(target))];
      const label = choice?.type === "nOf" ? choice.label : (rule.label ?? codes.join(" or "));
      return { kind: "slot", id: item.id, label, credits, filter: { codes }, for: target.id, ...counts };
    }
    if (rule?.type === "credits") {
      return { kind: "slot", id: item.id, label: creditLabel(rule.label, rule.filter), credits, filter: rule.filter, ...counts };
    }
    return { kind: "slot", id: item.id, label: "Elective", credits, filter: ELECTIVE, ...counts };
  };

  return terms.map((t) => ({ ...t, items: t.items.map((i) => (i.kind === "course" ? placeholder(i) : i)) }));
}
