"use client";

import type { AreaResult, RuleResult } from "@plotted/engine";
import type { Line } from "./diagram";
import { StatusMark } from "./status-mark";

interface Props {
  areas: AreaResult[];
  fresh: Set<string>;
  onHover: (ruleId: string | null) => void;
  notes: string[];
  lines: Line[];
}

function HoursBar({ earned, planned, required, color }: { earned: number; planned: number; required: number; color: string }) {
  const pct = (n: number) => `${Math.min(100, (n / required) * 100)}%`;
  return (
    <span
      className="relative mt-1.5 block h-1.5 overflow-hidden rounded-full bg-rule"
      role="img"
      aria-label={`${earned} of ${required} hours from courses, ${planned - earned} more from placeholders`}
    >
      <span
        className="absolute inset-y-0 left-0 opacity-40"
        style={{ width: pct(planned), background: `repeating-linear-gradient(135deg, ${color} 0 3px, transparent 3px 6px)` }}
      />
      <span className="absolute inset-y-0 left-0" style={{ width: pct(earned), background: color }} />
    </span>
  );
}

function RuleRow({ r, depth, muted, color, props }: { r: RuleResult; depth: number; muted: boolean; color: string; props: Props }) {
  const choiceDone = r.type === "nOf" && (r.status === "met" || r.status === "planned");
  return (
    <li className={muted ? "text-ink-soft" : ""}>
      <div
        className="flex items-start justify-between gap-2 rounded-chip px-1.5 py-1 hover:bg-focus/40 focus-within:bg-focus/40 hover:text-on-focus focus-within:text-on-focus"
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
          {r.hours && <HoursBar {...r.hours} color={color} />}
          {r.note && <span className="mt-0.5 block text-caption text-ink-soft">{r.note}</span>}
        </span>
        {muted ? (
          <span className="shrink-0 font-mono text-label text-ink-soft uppercase">Not chosen</span>
        ) : (
          <StatusMark status={r.status} fresh={props.fresh.has(r.id)} />
        )}
      </div>
      {r.children && r.type !== "course" && !muted && (
        <ul className="mt-0.5 ml-2.5 space-y-0.5 border-l-2 pl-2" style={{ borderColor: color }}>
          {r.children.map((c) => (
            <RuleRow key={c.id} r={c} depth={depth + 1} muted={choiceDone && c.status === "unmet"} color={color} props={props} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Service status: one entry per requirement line, opened to the rules that still need work. */
export function RequirementsPanel(props: Props) {
  return (
    <div className="divide-y divide-rule border-y border-rule">
      {props.areas.map((a) => {
        const line = props.lines.find((l) => l.id === a.id);
        const color = line?.color ?? "var(--ink)";
        return (
          <details key={a.id} id={`area-${a.id}`} open={a.result.status !== "met"} className="group/area py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="bullet" style={{ ["--c" as string]: color, ["--on" as string]: line?.on ?? "var(--paper)" }} aria-hidden>
                  {line?.mark ?? "Σ"}
                </span>
                <span className="font-display text-body leading-tight font-bold">{a.label}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusMark status={a.result.status} fresh={props.fresh.has(a.result.id)} size="lg" />
                <span aria-hidden className="font-mono text-caption text-ink-soft transition group-open/area:rotate-90">
                  ▸
                </span>
              </span>
            </summary>
            {a.result.hours && <HoursBar {...a.result.hours} color={color} />}
            {a.result.children ? (
              <ul className="mt-2 space-y-0.5">
                {a.result.children.map((c) => (
                  <RuleRow
                    key={c.id}
                    r={c}
                    depth={0}
                    muted={a.result.type === "nOf" && a.result.status !== "unmet" && c.status === "unmet"}
                    color={color}
                    props={props}
                  />
                ))}
              </ul>
            ) : (
              a.result.note && <p className="mt-2 text-caption text-ink-soft">{a.result.note}</p>
            )}
          </details>
        );
      })}
      {props.notes.length > 0 && (
        <details className="py-3 text-caption text-ink-soft">
          <summary className="cursor-pointer text-body-sm font-semibold text-ink">Not checked automatically ({props.notes.length})</summary>
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
