"use client";

import type { AreaResult, RuleResult } from "@plotted/engine";
import { StatusMark } from "./status-mark";

interface Props {
  areas: AreaResult[];
  fresh: Set<string>;
  onHover: (ruleId: string | null) => void;
  notes: string[];
}

/** Area cards wear their status ink: problems pink, planned violet, met blue. */
const AREA_INK: Record<string, string> = {
  unmet: "[--sticker-ink:var(--pink)]",
  partial: "[--sticker-ink:var(--pink)]",
  planned: "[--sticker-ink:var(--violet)]",
  met: "[--sticker-ink:var(--blue)]",
  manual: "",
};

function HoursBar({ earned, planned, required }: { earned: number; planned: number; required: number }) {
  const pct = (n: number) => `${Math.min(100, (n / required) * 100)}%`;
  return (
    <span
      className="relative mt-1 block h-2 overflow-hidden rounded-full border border-ink/60 bg-card"
      role="img"
      aria-label={`${earned} of ${required} hours from courses, ${planned - earned} more from placeholders`}
    >
      <span className="halftone absolute inset-y-0 left-0" style={{ width: pct(planned) }} />
      <span className="absolute inset-y-0 left-0 bg-blue" style={{ width: pct(earned) }} />
    </span>
  );
}

function RuleRow({ r, depth, muted, props }: { r: RuleResult; depth: number; muted: boolean; props: Props }) {
  const choiceDone = r.type === "nOf" && (r.status === "met" || r.status === "planned");
  return (
    <li className={muted ? "text-ink-soft [&_.stamp]:hidden" : ""}>
      <div
        className="flex items-start justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-yellow/40 focus-within:bg-yellow/40 hover:text-on-yellow focus-within:text-on-yellow"
        onMouseEnter={() => props.onHover(r.id)}
        onMouseLeave={() => props.onHover(null)}
        tabIndex={r.itemIds.length ? 0 : -1}
        onFocus={() => props.onHover(r.id)}
        onBlur={() => props.onHover(null)}
      >
        <span className="min-w-0 text-body-sm leading-snug">
          {r.label}
          {r.hours && (
            <span className="font-mono text-label text-ink-soft">
              {" "}
              {r.hours.planned}/{r.hours.required}
            </span>
          )}
          {r.count && r.count.required > 1 && (
            <span className="font-mono text-label text-ink-soft">
              {" "}
              {r.count.done}/{r.count.required}
            </span>
          )}
          {r.hours && <HoursBar {...r.hours} />}
          {r.note && <span className="mt-0.5 block text-label text-ink-soft">{r.note}</span>}
        </span>
        {muted ? (
          <span className="shrink-0 font-mono text-label text-ink-soft uppercase">Not chosen</span>
        ) : (
          <StatusMark status={r.status} fresh={props.fresh.has(r.id)} quiet />
        )}
      </div>
      {r.children && r.type !== "course" && !muted && (
        <ul className={`mt-0.5 space-y-0.5 ${depth >= 0 ? "ml-2 border-l-2 border-dotted border-rule pl-2" : ""}`}>
          {r.children.map((c) => (
            <RuleRow key={c.id} r={c} depth={depth + 1} muted={choiceDone && c.status === "unmet"} props={props} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function RequirementsPanel(props: Props) {
  return (
    <div className="space-y-3">
      {props.areas.map((a) => (
        <details
          key={a.id}
          open={a.result.status !== "met"}
          className={`sticker group/area p-3 hover:transform-none ${AREA_INK[a.result.status]}`}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span aria-hidden className="font-mono text-caption transition group-open/area:rotate-90">
                ▸
              </span>
              <span className="text-body font-bold">{a.label}</span>
            </span>
            <StatusMark status={a.result.status} fresh={props.fresh.has(a.result.id)} size="lg" />
          </summary>
          {a.result.hours && <HoursBar {...a.result.hours} />}
          {a.result.children ? (
            <ul className="mt-2 space-y-0.5">
              {a.result.children.map((c) => (
                <RuleRow
                  key={c.id}
                  r={c}
                  depth={0}
                  muted={a.result.type === "nOf" && a.result.status !== "unmet" && c.status === "unmet"}
                  props={props}
                />
              ))}
            </ul>
          ) : (
            a.result.note && <p className="mt-2 text-caption text-ink-soft">{a.result.note}</p>
          )}
        </details>
      ))}
      {props.notes.length > 0 && (
        <details className="rounded-card border-2 border-dashed border-rule p-3 text-caption text-ink-soft">
          <summary className="cursor-pointer text-body-sm font-semibold text-ink">
            Not checked automatically ({props.notes.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {props.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
