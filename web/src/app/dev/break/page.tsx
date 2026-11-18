import Link from "next/link";
import { notFound } from "next/navigation";
import { PlannerClient } from "@/components/planner/planner-client";
import { loadProgram } from "@/lib/catalog";
import { DATASETS, type Dataset, EXTRA_COURSES, fixtureProgram } from "./fixtures";

/** Reads ?data= on every request (a dev tool, not a prerendered page). */
export const instant = false;

/** break-ui stress test: the real planner fed worst-case plans. Dev only; 404 in production builds. */
export default async function BreakPage({ searchParams }: PageProps<"/dev/break">) {
  if (process.env.NODE_ENV === "production") notFound();
  const raw = (await searchParams).data;
  const data: Dataset = DATASETS.includes(raw as Dataset) ? (raw as Dataset) : "demo";
  const { program, courses, schoolName } = await loadProgram("ut-austin", "2026-28", "ut-cs-bs");
  return (
    <main className="flex-1">
      <PlannerClient
        key={data}
        program={fixtureProgram(program, data)}
        courses={[...courses, ...EXTRA_COURSES]}
        school="ut-austin"
        year="2026-28"
        schoolName={schoolName}
      />
      <nav
        aria-label="Test data"
        style={{ fontFamily: "system-ui", zIndex: 100 }}
        className="fixed bottom-3 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-full bg-neutral-300 p-0.5 text-xs text-black"
      >
        {DATASETS.map((d) => (
          <Link
            key={d}
            href={`?data=${d}`}
            aria-current={d === data ? "page" : undefined}
            className={`rounded-full px-2.5 py-1 ${d === data ? "bg-white font-semibold shadow-sm" : ""}`}
          >
            {{ demo: "Demo", worst: "Worst case", empty: "Empty", one: "One", huge: "120 items" }[d]}
          </Link>
        ))}
      </nav>
    </main>
  );
}
