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
        <span
          aria-hidden
          className="grid size-8 place-items-center rounded-full border-2 border-ink bg-yellow font-mono text-on-yellow text-sm font-medium"
        >
          {n}
        </span>
        <span className="text-lg font-extrabold tracking-tight">{title}</span>
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
      className={`sticker w-full px-4 py-3 text-left [--sticker-ink:var(--blue)] ${checked ? "bg-yellow! text-on-yellow **:text-on-yellow [--sticker-ink:var(--pink)]" : ""}`}
    >
      <span className="flex items-center justify-between gap-3">
        <span>{children}</span>
        <span aria-hidden className="font-mono text-lg">
          {checked ? "●" : "○"}
        </span>
      </span>
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
                <span className="block text-[13px] text-ink-soft">{p.degree}</span>
              </Choice>
            ))}
          </div>
        ) : (
          <p className="punchout px-4 py-6 text-[14px] text-ink-soft">Pick a school first.</p>
        )}
      </Step>

      <Step n={3} title="Start planning">
        {program ? (
          <div className="space-y-3">
            <p className="text-[13px] text-ink-soft">
              {program.schoolName} · <span className="font-mono">{program.year}</span> catalog
            </p>
            {saved ? (
              <>
                <Link
                  href={href()}
                  className="sticker block px-4 py-3 text-center text-lg font-extrabold [--sticker-ink:var(--pink)]"
                >
                  Continue your plan →
                </Link>
                <p className="text-[12px] text-ink-soft">Saved in this browser {new Date(saved).toLocaleDateString()}.</p>
                <Link href={href("suggested")} className="block text-[14px] font-semibold text-blue-text underline">
                  Start over from the suggested plan
                </Link>
              </>
            ) : (
              <>
                <Link
                  href={href("suggested")}
                  className="sticker block px-4 py-3 text-center text-lg font-extrabold [--sticker-ink:var(--pink)]"
                >
                  Start from the suggested plan →
                </Link>
                <p className="text-[12px] text-ink-soft">The catalog&apos;s own four-year layout, ready to edit.</p>
              </>
            )}
            <Link href={href("empty")} className="block text-[14px] font-semibold text-blue-text underline">
              Start with an empty plan
            </Link>
          </div>
        ) : (
          <p className="punchout px-4 py-6 text-[14px] text-ink-soft">Then choose how to start.</p>
        )}
      </Step>
    </div>
  );
}
