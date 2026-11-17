import Link from "next/link";
import { listPrograms } from "@/lib/catalog";

export default async function Home() {
  const programs = await listPrograms();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold">Plotted</h1>
      <p className="mt-2 text-neutral-500">Plan your degree against your school&apos;s real requirements.</p>
      <ul className="mt-8 space-y-2">
        {programs.map((p) => (
          <li key={`${p.school}/${p.id}`}>
            <Link
              href={`/plan/${p.school}/${p.year}/${p.id}`}
              className="block rounded-lg border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
            >
              <span className="text-sm text-neutral-500">
                {p.schoolName} · {p.year}
              </span>
              <span className="block font-medium">{p.name}</span>
              <span className="block text-sm text-neutral-500">{p.degree}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
