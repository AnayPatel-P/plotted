"use client";

import { useMemo } from "react";
import { evaluate, type Course, type Program, type RuleResult, type Status } from "@plotted/engine";

const STATUS_STYLE: Record<Status, { label: string; cls: string }> = {
  met: { label: "Met", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  planned: { label: "Planned", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  partial: { label: "Partial", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  unmet: { label: "Missing", cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" },
  manual: { label: "Check", cls: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
};

function Badge({ status }: { status: Status }) {
  const s = STATUS_STYLE[status];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>;
}

export function PlanView({ program, courses }: { program: Program; courses: Course[] }) {
  const byCode = useMemo(() => new Map(courses.map((c) => [c.code, c])), [courses]);
  const terms = program.suggestedPlan;
  const ev = useMemo(() => evaluate(program, byCode, terms), [program, byCode, terms]);
  const issuesByItem = new Map(ev.prereqIssues.map((i) => [i.itemId, i]));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section aria-label="Semester plan">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Suggested plan</h2>
          <span className="text-sm text-neutral-500">
            {ev.totalCredits} / {program.totalHours} hours
          </span>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2">
          {terms.map((term) => (
            <li key={term.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-medium">{term.label}</span>
                <span className="text-neutral-500">{ev.termCredits[term.id]} hrs</span>
              </div>
              <ul className="space-y-1.5">
                {term.items.map((item) => {
                  if (item.kind === "slot") {
                    return (
                      <li
                        key={item.id}
                        className="flex justify-between gap-2 rounded border border-dashed border-neutral-300 px-2 py-1 text-sm text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
                      >
                        <span>{item.label}</span>
                        <span>{item.credits}</span>
                      </li>
                    );
                  }
                  const course = byCode.get(item.code);
                  const issue = issuesByItem.get(item.id);
                  return (
                    <li
                      key={item.id}
                      className={`rounded px-2 py-1 text-sm ${issue ? "bg-rose-50 dark:bg-rose-950/40" : "bg-neutral-50 dark:bg-neutral-900"}`}
                    >
                      <div className="flex justify-between gap-2">
                        <span>
                          <span className="font-medium">{item.code}</span>
                          {item.alternatives?.length ? (
                            <span className="text-neutral-500"> or {item.alternatives.join(", ")}</span>
                          ) : null}
                          <span className="block text-xs text-neutral-500">{course?.title ?? "Not in catalog"}</span>
                        </span>
                        <span>{course?.credits ?? "?"}</span>
                      </div>
                      {issue ? (
                        <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">
                          Needs first: {issue.missing.join("; ")}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <aside aria-label="Requirements" className="space-y-3">
        <h2 className="font-semibold">Requirements</h2>
        {ev.areas.map((a) => (
          <details key={a.id} open className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm font-medium">
              {a.label} <Badge status={a.result.status} />
            </summary>
            <RuleTree r={a.result} depth={0} />
          </details>
        ))}
        {program.reviewNotes.length ? (
          <details className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
            <summary className="cursor-pointer text-sm font-medium">Not checked automatically ({program.reviewNotes.length})</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {program.reviewNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </aside>
    </div>
  );
}

function RuleTree({ r, depth, muted = false }: { r: RuleResult; depth: number; muted?: boolean }) {
  if (!r.children) return null;
  // In a satisfied "choose one" group, the options the plan didn't take aren't missing.
  const choiceDone = r.type === "nOf" && (r.status === "met" || r.status === "planned");
  return (
    <ul className={`mt-2 space-y-1 ${depth ? "border-l border-neutral-200 pl-3 dark:border-neutral-800" : ""}`}>
      {r.children.map((c) => {
        const unchosen = muted || (choiceDone && c.status === "unmet");
        return (
          <li key={c.id} className={`text-sm ${unchosen ? "text-neutral-400 dark:text-neutral-600" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <span>
                {c.label}
                {c.hours ? (
                  <span className="text-neutral-500">
                    {" "}
                    · {c.hours.planned}/{c.hours.required} hrs
                  </span>
                ) : null}
              </span>
              {unchosen ? <span className="shrink-0 text-[11px]">Not chosen</span> : <Badge status={c.status} />}
            </div>
            {c.type !== "course" && !unchosen ? <RuleTree r={c} depth={depth + 1} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
