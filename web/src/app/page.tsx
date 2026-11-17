import Link from "next/link";
import { Picker } from "@/components/picker";
import { listPrograms } from "@/lib/catalog";

export default async function Home() {
  const programs = await listPrograms();
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-10 pb-16">
      <header className="relative mb-12">
        <p className="font-mono text-caption text-ink-soft uppercase">Degree planner · UT Austin · Texas A&amp;M</p>
        <h1
          className="riso-title mt-2 text-[clamp(4rem,16vw,11rem)] leading-[0.8] font-extrabold tracking-tighter"
          style={{ fontVariationSettings: '"wdth" 75' }}
        >
          PLOTTED
        </h1>
        <p className="mt-5 max-w-xl text-[clamp(1.1rem,2.4vw,1.5rem)] leading-snug font-semibold">
          Lay out every semester of your degree and watch your real requirements tick off as you go.
        </p>
        <span
          aria-hidden
          className="stamp absolute top-2 right-0 hidden text-body-sm text-pink-text md:inline-block"
          style={{ transform: "rotate(8deg)" }}
        >
          Free · no sign-up
        </span>
      </header>

      <Picker programs={programs} />

      <footer className="mt-16 border-t-2 border-dashed border-rule pt-4 text-caption text-ink-soft">
        Plotted reads each school&apos;s public catalog. It isn&apos;t an official degree audit — check your plan with your advisor
        and your school&apos;s audit tool.{" "}
        <Link href="/about" className="font-semibold text-blue-text underline">
          About &amp; FAQ
        </Link>
      </footer>
    </main>
  );
}
