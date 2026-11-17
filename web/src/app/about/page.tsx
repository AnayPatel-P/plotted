import type { Metadata } from "next";
import Link from "next/link";
import { listPrograms } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "About & FAQ — Plotted",
  description: "How Plotted checks your degree plan, what it doesn't check, and what it stores.",
};

const faq: { q: string; a: React.ReactNode }[] = [
  {
    q: "Is this an official degree audit?",
    a: (
      <>
        No. Plotted reads your school&apos;s public catalog and checks your plan against it, but your official audit (UT&apos;s
        Interactive Degree Audit, Texas A&amp;M&apos;s degree evaluation) and your advisor have the final word. Use Plotted to
        plan ahead; confirm before you register.
      </>
    ),
  },
  {
    q: "What does Plotted check?",
    a: (
      <>
        Required courses and choices (&ldquo;one of these sequences&rdquo;), credit-hour requirements (&ldquo;12 hours of
        upper-division C S&rdquo;), the Texas core curriculum, total hours, prerequisites (including &ldquo;same semester is
        fine&rdquo;), and whether a prerequisite chain still fits before your last planned semester.
      </>
    ),
  },
  {
    q: "What doesn't it check?",
    a: (
      <>
        Grades and GPA minimums, residency rules, AP or transfer credit, which semesters a course is actually offered, class
        times, and a few rules each major lists under &ldquo;Not checked automatically&rdquo; in the planner. Placeholders
        (dashed boxes) count as <em>planned</em>, never <em>met</em>, until you pick a real course.
      </>
    ),
  },
  {
    q: "What does “no slack” mean?",
    a: (
      <>
        The course starts or sits on a prerequisite chain that needs every remaining semester. Taking it later — or failing it —
        pushes your graduation back. Tap any course to see what it builds on and leads to.
      </>
    ),
  },
  {
    q: "Where is my plan stored?",
    a: (
      <>
        In your browser, unless you sign in. Signing in with Google saves your plans to your Plotted account so they follow you
        to other devices; only you can read them. Signing out removes them from that browser. Share links contain the plan
        itself (after the <code>#</code>), which browsers never send to any server, so Plotted doesn&apos;t store shared plans
        at all.
      </>
    ),
  },
  {
    q: "Do you track me?",
    a: (
      <>
        Plotted counts a few anonymous events (a plan was started, a share link was made) with a random ID kept in your browser
        — no name, email, IP address or plan contents — so we can tell whether it&apos;s useful. No ads, no third-party
        trackers, no cookies for tracking.
      </>
    ),
  },
  {
    q: "My major or school isn't here.",
    a: (
      <>
        Plotted launched with three majors so each one could be checked carefully against the catalog. More are coming — each
        new major is reviewed by hand before it goes live.
      </>
    ),
  },
  {
    q: "I found a mistake.",
    a: (
      <>
        Catalogs change and parsing them is hard. Every requirement links back to its catalog page in the planner&apos;s Plan
        menu, so you can compare. Please tell us what you found and we&apos;ll fix it.
      </>
    ),
  },
];

export default async function About() {
  const programs = await listPrograms();
  const editions = [...new Map(programs.map((p) => [p.school, p])).values()];
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-16">
      <Link href="/" className="riso-title text-2xl font-extrabold" style={{ fontVariationSettings: '"wdth" 80' }}>
        PLOTTED
      </Link>
      <h1 className="mt-4 text-[clamp(2rem,6vw,3.5rem)] leading-none font-extrabold tracking-tight">About &amp; FAQ</h1>
      <p className="mt-4 text-lg leading-snug">
        Plotted lays out your whole degree semester by semester and checks it, live, against your school&apos;s real catalog — so
        you can see what&apos;s left, what&apos;s blocked, and what would delay graduation before you register.
      </p>

      <section className="sticker mt-8 p-4 [--sticker-ink:var(--blue)]">
        <h2 className="text-lg font-extrabold">Catalogs in Plotted</h2>
        <ul className="mt-2 space-y-1 text-[15px]">
          {editions.map((e) => (
            <li key={e.school}>
              <span className="font-semibold">{e.schoolName}</span> — <span className="font-mono">{e.year}</span> catalog:{" "}
              {programs
                .filter((p) => p.school === e.school)
                .map((p) => p.name)
                .join(", ")}
            </li>
          ))}
        </ul>
      </section>

      <dl className="mt-10 space-y-6">
        {faq.map(({ q, a }) => (
          <div key={q}>
            <dt className="text-xl font-extrabold tracking-tight">{q}</dt>
            <dd className="mt-1 text-[16px] leading-relaxed text-ink">{a}</dd>
          </div>
        ))}
      </dl>
    </main>
  );
}
