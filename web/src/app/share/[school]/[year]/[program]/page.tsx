import type { Metadata } from "next";
import { Suspense } from "react";
import { SharedPlanClient } from "@/components/planner/planner-client";
import { listPrograms, loadProgram } from "@/lib/catalog";

export async function generateStaticParams() {
  return (await listPrograms()).map((p) => ({ school: p.school, year: p.year, program: p.id }));
}

export const metadata: Metadata = {
  title: "Shared degree plan — Plotted",
  description: "A read-only degree plan shared from Plotted.",
  // Plans live in the link itself; keep shared pages out of search results.
  robots: { index: false, follow: false },
};

type Params = PageProps<"/share/[school]/[year]/[program]">["params"];

export default function SharePage({ params }: PageProps<"/share/[school]/[year]/[program]">) {
  return (
    <main className="flex-1">
      <Suspense
        fallback={
          <p className="riso-title p-8 text-3xl font-extrabold" role="status">
            Unfolding a shared plan…
          </p>
        }
      >
        <Shared params={params} />
      </Suspense>
    </main>
  );
}

async function Shared({ params }: { params: Params }) {
  const { school, year, program: programId } = await params;
  const { program, courses, schoolName } = await loadProgram(school, year, programId);
  return <SharedPlanClient program={program} courses={courses} school={school} year={year} schoolName={schoolName} />;
}
