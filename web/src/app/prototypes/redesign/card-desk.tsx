"use client";

import type { Course, Program } from "@plotted/engine";
import { useCallback, useState } from "react";
import { keyMove, type Stop, useDrag, usePlan } from "./model";

const MAX = 21;
const C = { x: 46, y: 48, r: 36 };
const pt = (h: number) => {
  const a = Math.PI - (Math.min(h, MAX) / MAX) * Math.PI;
  return `${C.x + C.r * Math.cos(a)} ${C.y - C.r * Math.sin(a)}`;
};
const arc = (from: number, to: number) => `M${pt(from)} A${C.r} ${C.r} 0 0 1 ${pt(to)}`;

/** Analog load gauge: the needle swings (with a little physical overshoot) when the semester's hours change. */
function Gauge({ hours }: { hours: number }) {
  const deg = -90 + (Math.min(hours, MAX) / MAX) * 180;
  return (
    <svg className="cd-gauge" viewBox="0 0 92 56" aria-hidden>
      <path className="arc" d={arc(0, 11.9)} stroke="var(--pencil)" opacity=".45" />
      <path className="arc" d={arc(12.1, 17.9)} stroke="var(--ok)" />
      <path className="arc" d={arc(18.1, MAX)} stroke="var(--signal)" />
      <g className="needle" style={{ transform: `rotate(${deg}deg)` }}>
        <line x1={C.x} y1={C.y} x2={C.x} y2={C.y - C.r + 4} stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <circle cx={C.x} cy={C.y} r="4" fill="var(--ink)" />
    </svg>
  );
}

const loadWord = (h: number) => (h === 0 ? "empty" : h < 12 ? "light" : h <= 17 ? "balanced" : "heavy");

export function CardDesk({ program, courses }: { program: Program; courses: Course[] }) {
  const plan = usePlan(program, courses);
  const { terms, stops, termDate, termCredits } = plan;
  const [settled, setSettled] = useState<{ id: string; r: number; key: number } | null>(null);
  const [tilt, setTilt] = useState(0);

  const onDrop = useCallback(
    (id: string, termId: string) => {
      plan.move(id, termId);
      setSettled((s) => ({ id, r: tilt, key: (s?.key ?? 0) + 1 }));
    },
    [plan, tilt],
  );
  const { drag, start } = useDrag(onDrop);
  const r = drag ? Math.max(-9, Math.min(9, drag.vx * 9)) : 0;
  if (drag && r !== tilt) setTilt(r);
  const dragStop = drag ? stops.find((s) => s.item.id === drag.itemId) : undefined;

  const card = (s: Stop) => (
    <button
      key={settled?.id === s.item.id ? `${s.item.id}-${settled.key}` : s.item.id}
      type="button"
      className="cd-card"
      data-stop={s.item.id}
      data-ph={s.placeholder ? "" : undefined}
      data-issue={s.issue ? "" : undefined}
      data-settle={settled?.id === s.item.id ? "" : undefined}
      style={{ ["--r" as string]: `${settled?.r ?? 0}deg`, opacity: drag?.itemId === s.item.id ? 0.2 : undefined }}
      onPointerDown={(e) => start(e, s.item.id)}
      onKeyDown={(e) => keyMove(e, s.item.id, plan.shift)}
      aria-label={`${s.placeholder ? `Placeholder: ${s.label}` : `${s.code}, ${s.label}`}, ${s.credits} hours${s.issue ? `. Needs ${s.issue.join(" and ")} first` : ""}. Arrow keys move it.`}
    >
      <span className="c">
        {s.placeholder ? s.label : s.code}
        <i>{s.credits}h</i>
      </span>
      <span className="n">{s.placeholder ? "pencil in a course" : s.label}</span>
      {s.issue && <span className="cd-flag">NEEDS {s.issue.join(" + ")}</span>}
    </button>
  );

  const issues = stops.filter((s) => s.issue).length;
  const heavy = terms.filter((t) => (termCredits[t.id] ?? 0) > 17).length;

  return (
    <div className="cd">
      <header className="cd-top">
        <h1>
          Plotted
          <small>UT Austin · Computer Science BS</small>
        </h1>
        <div className="cd-tape" role="status" aria-live="polite">
          Graduating {plan.finish}
          <span>
            · {plan.open.length ? `${plan.open.length} open` : "all covered"}
            {issues ? ` · ${issues} out of order` : ""}
            {heavy ? ` · ${heavy} heavy` : ""}
          </span>
        </div>
      </header>

      <div className="cd-rails">
        {terms.map((t) => {
          const h = termCredits[t.id] ?? 0;
          return (
            <section key={t.id} className="cd-rail" data-term-id={t.id} data-over={drag?.overTerm === t.id ? "" : undefined} aria-label={`${termDate(t)}, ${h} hours, ${loadWord(h)}`}>
              <div className="cd-head">
                <span>
                  <b>{termDate(t)}</b>
                  <span>
                    {h} HRS · {loadWord(h).toUpperCase()}
                  </span>
                </span>
                <Gauge hours={h} />
              </div>
              <div className="cd-cards">{stops.filter((s) => s.termId === t.id).map(card)}</div>
            </section>
          );
        })}
      </div>

      <p className="cd-hint">Pick up a card and drop it on another semester (or focus it and use ← →). Watch the gauge: past 17 hours the needle runs into the orange.</p>

      <section className="cd-ledger" aria-label="Requirements">
        <h2>Requirements ledger</h2>
        <ul>
          {plan.ev.areas.map((a) => {
            const res = a.result;
            const open = res.status === "unmet" || res.status === "partial";
            return (
              <li key={a.id} data-s={open ? "open" : "done"}>
                <i aria-hidden>{open ? "○" : res.status === "planned" ? "◐" : "●"}</i>
                <span>
                  {a.label.replace(/\s*\(.*\)/, "")}
                  <small>
                    {open ? "Open" : res.status === "planned" ? "Covered by placeholders" : res.status === "manual" ? "Confirm with advisor" : "Met"}
                    {res.hours ? ` · ${res.hours.earned + res.hours.planned}/${res.hours.required} hrs` : ""}
                  </small>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {drag && dragStop && (
        <div
          className="proto-ghost cd-ghost"
          style={{ ["--w" as string]: `${drag.w}px`, transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px)`, rotate: `${r}deg` }}
        >
          {dragStop.placeholder ? dragStop.label : dragStop.code}
          <span className="n">{dragStop.placeholder ? "" : dragStop.label}</span>
        </div>
      )}
    </div>
  );
}
