import { Suspense } from "react";
import { PlanView } from "@/components/plan-view";
import { loadProgram } from "@/lib/catalog";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading plan…</p>}>
        <Plan />
      </Suspense>
    </main>
  );
}

async function Plan() {
  const { program, courses, schoolName, catalogSize } = await loadProgram("ut-austin", "2026-28", "ut-cs-bs");
  return (
    <>
      <header className="mb-6">
        <p className="text-sm text-neutral-500">
          {schoolName} · {program.catalogYear} catalog · {catalogSize.toLocaleString()} courses scraped
        </p>
        <h1 className="text-2xl font-semibold">
          {program.name} <span className="font-normal text-neutral-500">— {program.degree}</span>
        </h1>
        <p className="mt-1 text-xs text-neutral-500">
          Walking skeleton (read-only). Not an official degree audit —{" "}
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
