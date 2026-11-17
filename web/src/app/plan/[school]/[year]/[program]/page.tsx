import { PlannerClient } from "@/components/planner/planner-client";
import { listPrograms, loadProgram } from "@/lib/catalog";

/**
 * Every program page is fully prerendered at build time, so phones on slow
 * networks get the whole plan in the first HTML response (no loading state,
 * no hidden-then-revealed content). Navigations wait for that static page
 * rather than streaming a placeholder, hence `instant = false`.
 */
export const ensureStatic = "navigation";
export const instant = false;

export async function generateStaticParams() {
  return (await listPrograms()).map((p) => ({ school: p.school, year: p.year, program: p.id }));
}

export default async function PlanPage({ params }: PageProps<"/plan/[school]/[year]/[program]">) {
  const { school, year, program: programId } = await params;
  const { program, courses, schoolName } = await loadProgram(school, year, programId);
  return (
    <main className="flex-1">
      <PlannerClient program={program} courses={courses} school={school} year={year} schoolName={schoolName} />
    </main>
  );
}
