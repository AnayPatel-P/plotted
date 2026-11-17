import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedPlanClient } from "@/components/planner/planner-client";
import { isKnownProgram, listPrograms, loadProgram } from "@/lib/catalog";

/** Prerendered per program; the shared plan itself (in the URL fragment) is read in the browser. */
export const ensureStatic = "navigation";
export const instant = false;

export async function generateStaticParams() {
  return (await listPrograms()).map((p) => ({ school: p.school, year: p.year, program: p.id }));
}

export const metadata: Metadata = {
  title: "Shared degree plan — Plotted",
  description: "A read-only degree plan shared from Plotted.",
  // Plans live in the link itself; keep shared pages out of search results.
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: PageProps<"/share/[school]/[year]/[program]">) {
  const { school, year, program: programId } = await params;
  if (!(await isKnownProgram(school, year, programId))) notFound();
  const { program, courses, schoolName } = await loadProgram(school, year, programId);
  return (
    <main className="flex-1">
      <SharedPlanClient program={program} courses={courses} school={school} year={year} schoolName={schoolName} />
    </main>
  );
}
