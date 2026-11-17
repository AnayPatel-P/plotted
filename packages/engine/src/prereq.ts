import type { Course, Prereq, Term } from "./schema";

export interface PrereqIssue {
  itemId: string;
  code: string;
  termId: string;
  /** Human-readable unmet pieces, e.g. ["C S 429", "one of M 362K, SDS 321"]. */
  missing: string[];
}

export interface PrereqNote {
  itemId: string;
  code: string;
  notes: string[];
}

/** Courses taken in terms strictly before `termIndex`, and in that term. */
function takenSets(terms: Term[], termIndex: number) {
  const before = new Set<string>();
  const same = new Set<string>();
  terms.forEach((t, i) => {
    for (const item of t.items) {
      if (item.kind !== "course") continue;
      if (i < termIndex) before.add(item.code);
      else if (i === termIndex) same.add(item.code);
    }
  });
  return { before, same };
}

function satisfied(p: Prereq, before: Set<string>, same: Set<string>): boolean {
  if ("course" in p) return before.has(p.course) || (!!p.concurrent && same.has(p.course));
  if ("all" in p) return p.all.every((c) => satisfied(c, before, same));
  if ("any" in p) return p.any.some((c) => satisfied(c, before, same));
  return true; // text: can't check, assume OK and show as a note
}

function describe(p: Prereq): string {
  if ("course" in p) return p.concurrent ? `${p.course} (or same term)` : p.course;
  if ("any" in p) {
    const parts = p.any.filter((c) => !("text" in c)).map(describe);
    return parts.length === 1 ? parts[0]! : `one of ${parts.join(", ")}`;
  }
  if ("all" in p) return p.all.map(describe).join(" and ");
  return p.text;
}

function unmetParts(p: Prereq, before: Set<string>, same: Set<string>): string[] {
  if (satisfied(p, before, same)) return [];
  if ("all" in p) return p.all.flatMap((c) => unmetParts(c, before, same));
  return [describe(p)];
}

function textNotes(p: Prereq): string[] {
  if ("text" in p) return [p.text];
  if ("all" in p) return p.all.flatMap(textNotes);
  if ("any" in p) return p.any.flatMap(textNotes);
  return [];
}

/** Check every planned course's prerequisites against earlier terms. */
export function checkPrereqs(terms: Term[], courses: Map<string, Course>) {
  const issues: PrereqIssue[] = [];
  const notes: PrereqNote[] = [];
  terms.forEach((term, ti) => {
    const { before, same } = takenSets(terms, ti);
    for (const item of term.items) {
      if (item.kind !== "course") continue;
      const course = courses.get(item.code);
      if (!course?.prereq) continue;
      const missing = unmetParts(course.prereq, before, same);
      if (missing.length) issues.push({ itemId: item.id, code: item.code, termId: term.id, missing });
      const n = textNotes(course.prereq);
      if (n.length) notes.push({ itemId: item.id, code: item.code, notes: n });
    }
  });
  return { issues, notes };
}
