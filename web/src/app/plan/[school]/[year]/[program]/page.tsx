import Link from "next/link";
import { Suspense } from "react";
import { PlanView } from "@/components/plan-view";
import { listPrograms, loadProgram } from "@/lib/catalog";

export async function generateStaticParams() {
  return (await listPrograms()).map((p) => ({ school: p.school, year: p.year, program: p.id }));
}

type Params = PageProps<"/plan/[school]/[year]/[program]">["params"];

export default function PlanPage({ params }: PageProps<"/plan/[school]/[year]/[program]">) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <Link href="/" className="text-sm text-neutral-500 underline">
        All programs
      </Link>
      <Suspense fallback={<p className="mt-4 text-sm text-neutral-500">Loading plan…</p>}>
        <Plan params={params} />
      </Suspense>
    </main>
  );
}

async function Plan({ params }: { params: Params }) {
  const { school, year, program: programId } = await params;
  const { program, courses, schoolName, catalogSize } = await loadProgram(school, year, programId);
  return (
    <>
      <header className="mt-2 mb-6">
        <p className="text-sm text-neutral-500">
          {schoolName} · {program.catalogYear} catalog · {catalogSize.toLocaleString()} courses scraped
        </p>
        <h1 className="text-2xl font-semibold">
          {program.name} <span className="font-normal text-neutral-500">— {program.degree}</span>
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          Read-only preview. Not an official degree audit —{" "}
          <a className="underline" href={program.sourceUrl}>
            check the catalog
          </a>
          .
        </p>
      </header>
      <PlanView program={program} courses={courses} />
    </>
  );
}
