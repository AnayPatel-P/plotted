/**
 * Plotted data schema.
 *
 * Catalog data (courses, programs) is produced by the Python scraper and
 * validated here. Plans are created by students in the app.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Prerequisites                                                       */
/* ------------------------------------------------------------------ */

/**
 * A prerequisite expression.
 * - `course`: needs this course in an earlier term (or the same term when
 *   `concurrent` is true, i.e. "credit or registration for").
 * - `all` / `any`: boolean combinations.
 * - `text`: a requirement we can't check automatically (e.g. "consent of
 *   instructor", "restricted to majors"). Treated as satisfied, but shown.
 */
export type Prereq =
  | { course: string; concurrent?: boolean }
  | { all: Prereq[] }
  | { any: Prereq[] }
  | { text: string };

export const Prereq: z.ZodType<Prereq> = z.lazy(() =>
  z.union([
    z.object({ course: z.string(), concurrent: z.boolean().optional() }).strict(),
    z.object({ all: z.array(Prereq) }).strict(),
    z.object({ any: z.array(Prereq) }).strict(),
    z.object({ text: z.string() }).strict(),
  ]),
);

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

export const Course = z.object({
  /** Canonical code as the school writes it, e.g. "C S 312". */
  code: z.string(),
  subject: z.string(),
  number: z.string(),
  title: z.string(),
  credits: z.number().nonnegative(),
  upperDivision: z.boolean(),
  /** Core / gen-ed area codes this course satisfies, e.g. ["060"]. */
  core: z.array(z.string()).default([]),
  prereq: Prereq.optional(),
  /** Cross-listed codes: the same course offered under another subject. */
  crossListed: z.array(z.string()).optional(),
  /** Original prerequisite text from the catalog, always kept for display. */
  prereqText: z.string().optional(),
  /** True when the prereq text could not be fully parsed. */
  prereqUnparsed: z.boolean().optional(),
});
export type Course = z.infer<typeof Course>;

/* ------------------------------------------------------------------ */
/* Requirement rules                                                   */
/* ------------------------------------------------------------------ */

/** Which courses can count toward a credit-hours rule or a plan slot. */
export const CourseFilter = z
  .object({
    codes: z.array(z.string()).optional(),
    subjects: z.array(z.string()).optional(),
    /** Subjects that never count (e.g. "upper-division coursework outside math and science"). */
    excludeSubjects: z.array(z.string()).optional(),
    upperDivision: z.boolean().optional(),
    core: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    /** Matches any course (free electives). */
    any: z.boolean().optional(),
  })
  .strict();
export type CourseFilter = z.infer<typeof CourseFilter>;

/**
 * A requirement rule tree.
 * - `course`: take this course (or one of `alternatives`).
 * - `allOf`: every child rule.
 * - `nOf`: at least `n` child rules (e.g. "choose a sequence").
 * - `credits`: at least `hours` credit hours from courses matching `filter`.
 * - `manual`: a rule we can't check (grade/GPA/residency); shown as a reminder.
 */
export type Rule =
  | { type: "course"; id: string; code: string; alternatives?: string[]; label?: string }
  | { type: "allOf"; id: string; label: string; rules: Rule[] }
  | { type: "nOf"; id: string; label: string; n: number; rules: Rule[] }
  | { type: "credits"; id: string; label: string; hours: number; filter: CourseFilter }
  | { type: "manual"; id: string; label: string; note?: string };

export const Rule: z.ZodType<Rule> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("course"),
        id: z.string(),
        code: z.string(),
        alternatives: z.array(z.string()).optional(),
        label: z.string().optional(),
      })
      .strict(),
    z.object({ type: z.literal("allOf"), id: z.string(), label: z.string(), rules: z.array(Rule) }).strict(),
    z
      .object({
        type: z.literal("nOf"),
        id: z.string(),
        label: z.string(),
        n: z.number().int().positive(),
        rules: z.array(Rule),
      })
      .strict(),
    z
      .object({
        type: z.literal("credits"),
        id: z.string(),
        label: z.string(),
        hours: z.number().positive(),
        filter: CourseFilter,
      })
      .strict(),
    z.object({ type: z.literal("manual"), id: z.string(), label: z.string(), note: z.string().optional() }).strict(),
  ]),
);

/**
 * A top-level requirement area (Major, Core Curriculum, ...).
 * Within one area a course counts at most once.
 * `exclusive` areas (concentration, major, degree) also never share a course
 * with each other. Non-exclusive areas (core curriculum, total hours) may reuse
 * courses already counted elsewhere (UT: "required courses may also satisfy
 * the core").
 */
export const RequirementArea = z.object({
  id: z.string(),
  label: z.string(),
  exclusive: z.boolean().default(true),
  rule: Rule,
});
export type RequirementArea = z.infer<typeof RequirementArea>;

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

/** A placeholder in a plan, e.g. "Upper-division C S, 3 hours". */
export const PlanSlot = z.object({
  kind: z.literal("slot"),
  id: z.string(),
  label: z.string(),
  credits: z.number().nonnegative(),
  filter: CourseFilter,
  /**
   * The requirement rule this placeholder stands for (a course rule, or a choice such as
   * "one science sequence"). Such a slot can count as planned toward that rule.
   */
  for: z.string().optional(),
  /**
   * What the catalog's suggested course here also counts toward (core flags, upper-division),
   * so a requirement placeholder keeps that credit without narrowing which courses fit.
   */
  counts: z.object({ core: z.array(z.string()).optional(), upperDivision: z.boolean().optional() }).optional(),
});
export type PlanSlot = z.infer<typeof PlanSlot>;

export const PlanCourse = z.object({
  kind: z.literal("course"),
  id: z.string(),
  code: z.string(),
  /** Other acceptable choices shown in the suggested plan ("M 408C or M 408N"). */
  alternatives: z.array(z.string()).optional(),
  /** The placeholder this course was picked for; removing the course puts it back. */
  placeholder: PlanSlot.optional(),
});
export type PlanCourse = z.infer<typeof PlanCourse>;

export const PlanItem = z.discriminatedUnion("kind", [PlanCourse, PlanSlot]);
export type PlanItem = z.infer<typeof PlanItem>;

export const Term = z.object({
  id: z.string(),
  label: z.string(),
  items: z.array(PlanItem),
  /** v2: "credit" = credit earned before college (AP, dual credit, transfer). Absent = a semester. */
  kind: z.literal("credit").optional(),
});
export type Term = z.infer<typeof Term>;

/* ------------------------------------------------------------------ */
/* Programs and catalogs                                               */
/* ------------------------------------------------------------------ */

export const Program = z.object({
  id: z.string(),
  school: z.string(),
  catalogYear: z.string(),
  name: z.string(),
  degree: z.string(),
  totalHours: z.number().positive(),
  sourceUrl: z.string().url(),
  scrapedAt: z.string(),
  areas: z.array(RequirementArea),
  suggestedPlan: z.array(Term),
  /** Things a person should double-check (unparsed rows, assumptions). */
  reviewNotes: z.array(z.string()).default([]),
});
export type Program = z.infer<typeof Program>;

export const Catalog = z.object({
  school: z.string(),
  schoolName: z.string(),
  catalogYear: z.string(),
  sourceUrl: z.string().url(),
  scrapedAt: z.string(),
  courses: z.array(Course),
});
export type Catalog = z.infer<typeof Catalog>;

/* ------------------------------------------------------------------ */
/* Offerings (v2): when courses have run recently                      */
/* ------------------------------------------------------------------ */

export const OfferingPattern = z.enum(["fall-spring", "fall", "spring", "irregular"]);
export type OfferingPattern = z.infer<typeof OfferingPattern>;

export const CourseOffering = z.object({
  /** Terms with at least one section, e.g. ["Fall 2024", "Spring 2025"]. */
  seen: z.array(z.string()),
  pattern: OfferingPattern,
  confidence: z.enum(["high", "medium", "low"]),
  summer: z.boolean(),
});
export type CourseOffering = z.infer<typeof CourseOffering>;

export const Offerings = z.object({
  school: z.string(),
  source: z.string().url(),
  scrapedAt: z.string(),
  terms: z.array(z.string()),
  termCounts: z.record(z.string(), z.number()),
  coverage: z.object({ named: z.number(), seen: z.number() }),
  subjects: z.array(z.string()),
  courses: z.record(z.string(), CourseOffering),
});
export type Offerings = z.infer<typeof Offerings>;
