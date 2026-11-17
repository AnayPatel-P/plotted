/**
 * Real semesters for a plan (v2). Plans label semesters "Year 2 · Spring"; with
 * a start term ("Fall 2025") each maps to a real term ("Spring 2027"), and
 * today's date marks it completed, in progress, or future.
 */
import type { Term } from "./schema";

export const SEASONS = ["Spring", "Summer", "Fall"] as const;
export type Season = (typeof SEASONS)[number];
export interface RealTerm {
  season: Season;
  year: number;
}
export type TermStatus = "completed" | "in-progress" | "future";

export interface TermInfo {
  kind: "credit" | "semester";
  real?: RealTerm;
  /** e.g. "Spring 2027" */
  realLabel?: string;
  status?: TermStatus;
}

const order = (t: RealTerm) => t.year * 3 + SEASONS.indexOf(t.season);

export function parseRealTerm(s: string | null | undefined): RealTerm | null {
  const m = s?.match(/^(Spring|Summer|Fall) (\d{4})$/);
  return m ? { season: m[1] as Season, year: Number(m[2]) } : null;
}

export const formatRealTerm = (t: RealTerm) => `${t.season} ${t.year}`;

/** The term a date falls in: Jan–May spring, Jun–Jul summer, Aug–Dec fall. */
export function currentRealTerm(date: Date): RealTerm {
  const m = date.getMonth();
  return { season: m <= 4 ? "Spring" : m <= 6 ? "Summer" : "Fall", year: date.getFullYear() };
}

/** "Year N · Season" → real term, given the student's start term. */
export function realTermFor(label: string, start: RealTerm): RealTerm | null {
  const m = label.match(/^Year (\d+) · (Spring|Summer|Fall)$/);
  if (!m) return null;
  const n = Number(m[1]);
  const season = m[2] as Season;
  // Academic year 1 begins the fall on or before the start term.
  const firstFall = start.season === "Fall" ? start.year : start.year - 1;
  return { season, year: season === "Fall" ? firstFall + n - 1 : firstFall + n };
}

/**
 * `today` is explicit (no default) so callers never read the clock by accident,
 * e.g. while a page is prerendered at build time. Without it, no statuses.
 */
export function termCalendar(terms: Term[], startTerm: string | null | undefined, today: Date | null): Map<string, TermInfo> {
  const start = parseRealTerm(startTerm);
  const now = today ? currentRealTerm(today) : null;
  const out = new Map<string, TermInfo>();
  for (const t of terms) {
    if (t.kind === "credit") {
      out.set(t.id, { kind: "credit" });
      continue;
    }
    const real = start ? realTermFor(t.label, start) : null;
    if (!real) {
      out.set(t.id, { kind: "semester" });
      continue;
    }
    const status: TermStatus | undefined = !now
      ? undefined
      : order(real) < order(now)
        ? "completed"
        : order(real) === order(now)
          ? "in-progress"
          : "future";
    out.set(t.id, { kind: "semester", real, realLabel: formatRealTerm(real), ...(status ? { status } : {}) });
  }
  return out;
}

/** Index of the first term a plan can still change (not credit, not completed). */
export function firstChangeableIndex(terms: Term[], calendar: Map<string, TermInfo>): number {
  const i = terms.findIndex((t) => {
    const info = calendar.get(t.id);
    return info?.kind !== "credit" && info?.status !== "completed";
  });
  return i === -1 ? terms.length : i;
}
