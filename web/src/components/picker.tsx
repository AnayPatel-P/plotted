"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { markFirstSeen } from "@/lib/analytics";
import type { ProgramSummary } from "@/lib/catalog";
import { loadSaved, storageKey } from "@/lib/plan-state";

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 flex items-center gap-3">
        <span aria-hidden className="bullet" style={{ ["--c" as string]: `var(--line-${n})`, ["--on" as string]: `var(--on-line-${n})` }}>
          {n}
        </span>
        <span className="text-title-sm font-extrabold">{title}</span>
      </legend>
      {children}
    </fieldset>
  );
}

function Choice({ checked, onSelect, children }: { checked: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-chip border-[1.5px] px-3 py-3 text-left transition-colors ${
        checked ? "border-ink bg-card" : "border-rule hover:border-ink"
      }`}
    >
      <span
        aria-hidden
        className="size-3.5 shrink-0 rounded-full transition-colors"
        style={{ boxShadow: "0 0 0 3px var(--ink)", background: checked ? "var(--ink)" : "var(--card)" }}
      />
      <span className="min-w-0">{children}</span>
    </button>
  );
}

export function Picker({ programs }: { programs: ProgramSummary[] }) {
  const schools = useMemo(() => [...new Map(programs.map((p) => [p.school, p.schoolName])).entries()], [programs]);
  const [school, setSchool] = useState<string | null>(null);
  const [programId, setProgramId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(markFirstSeen, []);

  const majors = programs.filter((p) => p.school === school);
  const program = majors.find((p) => p.id === programId) ?? null;

  const choose = (p: ProgramSummary | null) => {
    setProgramId(p?.id ?? null);
    setSaved(p ? (loadSaved(storageKey(p.school, p.year, p.id))?.savedAt ?? null) : null);
  };

  const href = (start?: string) =>
    program ? `/plan/${program.school}/${program.year}/${program.id}${start ? `?start=${start}` : ""}` : "#";

  return (
    <div className="grid gap-8 md:grid-cols-3">
      <Step n={1} title="Your school">
        <div role="radiogroup" aria-label="School" className="space-y-3">
          {schools.map(([id, name]) => (
            <Choice
              key={id}
              checked={school === id}
              onSelect={() => {
                setSchool(id);
                choose(null);
              }}
            >
              <span className="block font-bold">{name}</span>
            </Choice>
          ))}
        </div>
      </Step>

      <Step n={2} title="Your major">
        {school ? (
          <div role="radiogroup" aria-label="Major" className="space-y-3">
            {majors.map((p) => (
              <Choice key={p.id} checked={programId === p.id} onSelect={() => choose(p)}>
                <span className="block font-bold">{p.name}</span>
                <span className="block text-body-sm text-ink-soft">{p.degree}</span>
              </Choice>
            ))}
          </div>
        ) : (
          <p className="rounded-chip border-[1.5px] border-dashed border-rule px-4 py-6 text-body-sm text-ink-soft">Pick a school first.</p>
        )}
      </Step>

      <Step n={3} title="Start planning">
        {program ? (
          <div className="space-y-3">
            <p className="text-body-sm text-ink-soft">
              {program.schoolName} · <span className="font-mono">{program.year}</span> catalog
            </p>
            {saved ? (
              <>
                <Link
                  href={href()}
                  className="btn btn-primary w-full justify-center px-4 py-3 text-title-sm font-extrabold"
                >
                  Continue your plan →
                </Link>
                <p className="text-caption text-ink-soft">Saved in this browser {new Date(saved).toLocaleDateString()}.</p>
                <Link href={href("suggested")} className="block text-body-sm font-semibold underline underline-offset-2">
                  Start over from the suggested plan
                </Link>
              </>
            ) : (
              <>
                <Link
                  href={href("suggested")}
                  className="btn btn-primary w-full justify-center px-4 py-3 text-title-sm font-extrabold"
                >
                  Start from the suggested plan →
                </Link>
                <p className="text-caption text-ink-soft">The catalog&apos;s own four-year layout, ready to edit.</p>
              </>
            )}
            <Link href={href("empty")} className="block text-body-sm font-semibold underline underline-offset-2">
              Start with just the requirements
            </Link>
          </div>
        ) : (
          <p className="rounded-chip border-[1.5px] border-dashed border-rule px-4 py-6 text-body-sm text-ink-soft">Then choose how to start.</p>
        )}
      </Step>
    </div>
  );
}
