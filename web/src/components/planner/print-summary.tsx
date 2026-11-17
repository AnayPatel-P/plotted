import type { DelayWarning, Evaluation, Program, RuleResult } from "@plotted/engine";
import { STATUS } from "./status-mark";

/** Open requirements in an area: the most specific unmet/partial rules (unchosen options skipped). */
function openItems(r: RuleResult): RuleResult[] {
  if (r.status === "met" || r.status === "manual") return [];
  if (!r.children || r.type === "nOf") return [r];
  const kids = r.children.flatMap(openItems);
  return kids.length ? kids : [r];
}

/** Compact, print-only summary under the semester grid (hidden on screen). */
export function PrintSummary({
  program,
  ev,
  delays,
  schoolName,
}: {
  program: Program;
  ev: Evaluation;
  delays: DelayWarning[];
  schoolName: string;
}) {
  return (
    <section className="mt-4 hidden break-inside-avoid text-[10pt] leading-snug print:block" aria-hidden>
      <h2 className="mb-1 text-[13pt] font-extrabold">Requirements</h2>
      <ul className="columns-2 gap-6">
        {ev.areas.map((a) => {
          const s = STATUS[a.result.status];
          const open = openItems(a.result).filter((x) => x.id !== a.result.id);
          return (
            <li key={a.id} className="mb-1.5 break-inside-avoid">
              <span className="font-bold">
                {s.glyph} {a.label}
              </span>{" "}
              — {s.word}
              {a.result.hours ? ` (${a.result.hours.planned}/${a.result.hours.required} hrs)` : ""}
              {open.length > 0 && (
                <ul className="list-disc pl-5">
                  {open.slice(0, 6).map((r) => (
                    <li key={r.id}>
                      {r.label} — {STATUS[r.status].word}
                      {r.hours ? ` (${r.hours.planned}/${r.hours.required} hrs)` : ""}
                    </li>
                  ))}
                  {open.length > 6 && <li>…and {open.length - 6} more</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {(ev.prereqIssues.length > 0 || delays.length > 0) && (
        <>
          <h2 className="mt-2 mb-1 text-[11pt] font-extrabold">Timing problems</h2>
          <ul className="list-disc pl-5">
            {delays.map((d) => (
              <li key={d.itemId}>
                Graduation slips: {d.chain.join(" → ")} needs {d.termsNeeded} more semesters after {d.code}; {d.termsLeft} remain.
              </li>
            ))}
            {ev.prereqIssues.map((i) => (
              <li key={i.itemId}>
                {i.code} needs first: {i.missing.join("; ")}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 border-t border-rule pt-1 text-[8pt] text-ink-soft">
        Made with Plotted from the {schoolName} {program.catalogYear} catalog ({program.sourceUrl}) on{" "}
        {new Date().toLocaleDateString()}. Not an official degree audit — confirm with your advisor and your school&apos;s audit tool.
        Some rules aren&apos;t checked automatically: {program.reviewNotes.length} noted in the app.
      </p>
    </section>
  );
}
