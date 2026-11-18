import type { Course, PlanItem, Program, Term } from "@plotted/engine";

/**
 * Worst-case plans for the break-ui stress test (dev only, see page.tsx).
 * Every value is real catalog data or something a student can produce in the app.
 */

export const DATASETS = ["demo", "worst", "empty", "one", "huge"] as const;
export type Dataset = (typeof DATASETS)[number];

/** Real UT courses with extreme values: the longest title in the catalog, 0 hours, topics courses. */
export const EXTRA_COURSES: Course[] = [
  {
    code: "GSD 361G",
    subject: "GSD",
    number: "361G",
    title: "Northern Gods, Northern Faiths: The Conversion of Scandinavians, Finns, Northern Slavs and Shamans",
    credits: 3,
    upperDivision: true,
    core: [],
    prereq: { text: "Upper-division standing" },
  },
  {
    code: "E S 079M",
    subject: "E S",
    number: "079M",
    title: "Undergraduate Research Experience",
    credits: 0,
    upperDivision: false,
    core: [],
  },
  {
    code: "ELP 017",
    subject: "ELP",
    number: "017",
    title: "First-Year Connection Seminar: University Leadership Network",
    credits: 0,
    upperDivision: false,
    core: [],
  },
];

const c = (id: string, code: string): PlanItem => ({ kind: "course", id, code });
const s = (id: string, label: string, credits = 3): PlanItem => ({ kind: "slot", id, label, credits, filter: { any: true } });
const term = (label: string, items: PlanItem[], kind?: "credit"): Term => ({
  id: kind ? "credit" : label.toLowerCase().replace(/\W+/g, "-"),
  label,
  items,
  ...(kind ? { kind } : {}),
});

/** The longest placeholder label in any shipped program (UT Math BS). */
const LONG_SLOT =
  "Upper-division coursework (excluding Astronomy, Biology, Chemistry, Geological Sciences, Mathematics, and Physics. Philosophy courses in logic, Computer Science courses in discrete mathematics, Engineering, and Actuarial Foundation courses may not be used to fulfill this requirement)";

function worst(): Term[] {
  return [
    // A student with a lot of AP and dual credit.
    term(
      "Credit before college",
      ["M 408C", "M 408D", "RHE 306", "GOV 310L", "GOV 312L", "SDS 321", "E S 079M"].map((x, i) => c(`cr-${i}`, x)),
      "credit",
    ),
    // Overloaded first semester: 9 items, a 0-hour seminar, the longest title, a placeholder with the longest label.
    term("Year 1 · Fall", [
      c("a1", "C S 312"),
      c("a2", "GSD 361G"),
      c("a3", "ELP 017"),
      c("a4", "C S 314"),
      c("a5", "C S 439"), // prerequisite later in the plan: backwards track + issue text
      c("a6", "C S 378H"),
      s("a7", LONG_SLOT),
      s("a8", "Social and Behavioral Sciences (080)"),
      c("a9", "C S 395T"), // not in this catalog (graduate course)
    ]),
    term("Year 1 · Spring", [c("b1", "C S 311"), s("b2", "First-Year Signature Course (090) approved by departmental advisor")]),
    term("Year 1 · Summer", [c("b3", "C S 429")]),
    term("Year 2 · Fall", []),
    term("Year 2 · Spring", [c("d1", "M 340L"), s("d2", "Upper-division C S")]),
    term("Year 3 · Fall", [c("e1", "C S 331"), s("e2", "Natural Science and Technology, Part I (030)")]),
    term("Year 3 · Spring", [s("f1", "Upper-division C S"), s("f2", "Upper-division C S")]),
    term("Year 4 · Fall", [s("g1", "Upper-division C S"), s("g2", "Free Elective")]),
    term("Year 4 · Spring", [s("h1", "Upper-division C S")]),
    // A 5th and 6th year (part-time, double major, co-op): 13 columns in all.
    term("Year 5 · Fall", [c("i1", "C S 371D")]),
    term("Year 5 · Spring", [s("j1", "Free Elective", 1)]),
    term("Year 6 · Fall", [s("k1", "Humanities (040)")]),
  ];
}

function huge(): Term[] {
  const codes = ["C S 312", "C S 311", "C S 314", "C S 429", "C S 439", "C S 331", "M 408C", "M 408D", "M 340L", "SDS 321"];
  return Array.from({ length: 12 }, (_, t) =>
    term(
      `Year ${Math.floor(t / 2) + 1} · ${t % 2 ? "Spring" : "Fall"}`,
      Array.from({ length: 10 }, (_, i) => (i < 4 ? c(`h${t}-${i}`, codes[(t + i) % codes.length]!) : s(`h${t}-${i}`, "Free Elective"))),
    ),
  );
}

export function fixtureProgram(base: Program, data: Dataset): Program {
  if (data === "demo") return base;
  const suggestedPlan =
    data === "worst"
      ? worst()
      : data === "empty"
        ? base.suggestedPlan.map((t) => ({ ...t, items: [] }))
        : data === "one"
          ? [term("Year 1 · Fall", [c("o1", "C S 103F")])]
          : huge();
  return {
    ...base,
    // A separate storage key per dataset, so a saved demo plan never replaces the fixture.
    id: `${base.id}--break-${data}`,
    name: data === "worst" ? "Computer Science (Turing Scholars Honors, Integrated BS/MS Pathway)" : base.name,
    areas:
      data === "worst"
        ? base.areas.map((a) =>
            a.id === "core"
              ? { ...a, label: "Core Curriculum, including Cultural Diversity and Global Cultures flags (3 hours each)" }
              : a,
          )
        : base.areas,
    suggestedPlan,
  };
}
