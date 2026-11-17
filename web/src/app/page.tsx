import Link from "next/link";
import { Picker } from "@/components/picker";
import { listPrograms } from "@/lib/catalog";

/** Four requirement lines leaving freshman fall and meeting at graduation: the planner in one picture. */
function RouteMap() {
  const lines = [
    { c: "var(--line-1)", d: "M8 30 H120 L150 60 H360 L390 90 H560" },
    { c: "var(--line-2)", d: "M8 60 H200 L230 90 H300 L330 60 H520 L550 90 H560" },
    { c: "var(--line-3)", d: "M8 90 H90 L120 120 H420 L450 90 H560" },
    { c: "var(--line-5)", d: "M8 120 H250 L280 150 H470 L530 90 H560" },
  ];
  const stops = [
    [8, 30],
    [120, 30],
    [260, 60],
    [8, 60],
    [200, 60],
    [420, 60],
    [8, 90],
    [300, 90],
    [8, 120],
    [180, 120],
    [360, 120],
    [350, 150],
  ];
  return (
    <svg viewBox="0 0 600 170" className="h-auto w-full max-w-[600px]" aria-hidden>
      {lines.map((l) => (
        <path key={l.d} d={l.d} fill="none" stroke={l.c} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {stops.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
      ))}
      <rect x="548" y="22" width="24" height="136" rx="12" fill="var(--ink)" />
      <text x="584" y="94" fill="var(--ink)" fontSize="11" fontFamily="var(--font-code)" transform="rotate(90 584 94)" textAnchor="middle">
        GRADUATION
      </text>
    </svg>
  );
}

export default async function Home() {
  const programs = await listPrograms();
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 pb-16 sm:px-6">
      <header className="mb-12 grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)]">
        <div>
          <p className="font-mono text-label text-ink-soft uppercase">Degree planner · UT Austin · Texas A&amp;M</p>
          <h1 className="wordmark mt-3 text-display">Plotted</h1>
          <p className="mt-5 max-w-xl text-[clamp(1.1rem,2.4vw,1.5rem)] leading-snug font-semibold">
            Your degree as a route map: every semester a station, every requirement a line, checked live against your
            school&apos;s real catalog.
          </p>
          <p className="mt-3 font-mono text-caption text-ink-soft">Free · no sign-up · plans stay in your browser</p>
        </div>
        <RouteMap />
      </header>

      <Picker programs={programs} />

      <footer className="mt-16 border-t border-rule pt-4 text-caption text-ink-soft">
        Plotted reads each school&apos;s public catalog. It isn&apos;t an official degree audit — check your plan with your advisor
        and your school&apos;s audit tool.{" "}
        <Link href="/about" className="font-semibold text-ink underline underline-offset-2">
          About &amp; FAQ
        </Link>
      </footer>
    </main>
  );
}
