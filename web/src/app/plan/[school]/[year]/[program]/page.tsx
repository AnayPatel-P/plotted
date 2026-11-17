import { Suspense } from "react";
import { PlannerClient } from "@/components/planner/planner-client";
import { listPrograms, loadProgram } from "@/lib/catalog";

export async function generateStaticParams() {
  return (await listPrograms()).map((p) => ({ school: p.school, year: p.year, program: p.id }));
}

type Params = PageProps<"/plan/[school]/[year]/[program]">["params"];

export default function PlanPage({ params }: PageProps<"/plan/[school]/[year]/[program]">) {
  return (
    <main className="flex-1">
      <Suspense
        fallback={
          <p className="riso-title p-8 text-3xl font-extrabold" role="status">
            Inking your plan…
          </p>
        }
      >
        <Plan params={params} />
      </Suspense>
    </main>
  );
}

async function Plan({ params }: { params: Params }) {
  const { school, year, program: programId } = await params;
  const { program, courses, schoolName } = await loadProgram(school, year, programId);
  return <PlannerClient program={program} courses={courses} school={school} year={year} schoolName={schoolName} />;
}
