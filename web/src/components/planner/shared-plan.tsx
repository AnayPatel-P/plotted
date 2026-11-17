"use client";

import { type Course, type Program, requirementSkeleton, type Term } from "@plotted/engine";
import Link from "next/link";
import { useEffect, useState } from "react";
import { decodePlan } from "@/lib/share-codec";
import { Planner } from "./planner";

type Loaded = { terms: Term[]; extraCourses: Course[]; startTerm: string | null };

/** Reads the plan from the URL fragment (#p=…) and shows it read-only. */
export function SharedPlan(props: { program: Program; courses: Course[]; school: string; year: string; schoolName: string }) {
  const { program, courses, school, year } = props;
  const [plan, setPlan] = useState<Loaded | "error" | null>(null);
  const [hash, setHash] = useState(() => window.location.hash);

  // A different link pasted into the same tab only changes the fragment; re-read it.
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const encoded = new URLSearchParams(hash.slice(1)).get("p");
        if (!encoded) throw new Error("missing");
        const templates = requirementSkeleton(program, new Map(courses.map((c) => [c.code, c]))).flatMap((t) =>
          t.items.flatMap((i) => (i.kind === "slot" ? [i] : [])),
        );
        const { terms, startTerm } = await decodePlan(encoded, program, templates);
        const known = new Set(courses.map((c) => c.code));
        const missing = [...new Set(terms.flatMap((t) => t.items.flatMap((i) => (i.kind === "course" ? [i.code] : []))))].filter(
          (c) => !known.has(c),
        );
        let extraCourses: Course[] = [];
        if (missing.length) {
          const params = new URLSearchParams({ school, year, codes: missing.join(",") });
          const res = await fetch(`/api/courses?${params}`);
          if (res.ok) extraCourses = ((await res.json()) as { courses: Course[] }).courses;
        }
        if (alive) setPlan({ terms, extraCourses, startTerm });
      } catch {
        if (alive) setPlan("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [hash, program, courses, school, year]);

  if (plan === null) {
    return (
      <p className="wordmark p-8 text-3xl" role="status">
        Unfolding a shared plan…
      </p>
    );
  }
  if (plan === "error") {
    // (keyed on the hash so a fixed link replaces the error)
    return (
      <div className="mx-auto max-w-xl p-8">
        <h1 className="wordmark text-4xl">This share link is broken</h1>
        <p className="mt-3 text-ink-soft">
          The plan in the link couldn&apos;t be read — it may have been cut off when it was copied. Ask for the link again, or{" "}
          <Link className="font-semibold underline underline-offset-2" href={`/plan/${school}/${year}/${program.id}`}>
            start your own {program.name} plan
          </Link>
          .
        </p>
      </div>
    );
  }
  return <Planner key={hash} {...props} mode="view" shared={plan} />;
}
