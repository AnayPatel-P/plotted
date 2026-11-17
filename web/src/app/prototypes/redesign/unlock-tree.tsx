"use client";

import type { Course, Program } from "@plotted/engine";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { keyMove, type Stop, useDrag, usePlan } from "./model";

type Box = { x: number; top: number; bottom: number };

/** Orthogonal edge: down out of the prerequisite, across just above the target, down into it. */
function edgePath(a: Box, b: Box) {
  if (b.top <= a.bottom) return { d: `M${a.x} ${a.bottom} L${b.x} ${b.top}`, len: Math.hypot(b.x - a.x, b.top - a.bottom), bad: true };
  const mid = b.top - 14;
  return { d: `M${a.x} ${a.bottom} V${mid} H${b.x} V${b.top}`, len: mid - a.bottom + Math.abs(b.x - a.x) + 14, bad: false };
}

export function UnlockTree({ program, courses }: { program: Program; courses: Course[] }) {
  const plan = usePlan(program, courses);
  const { terms, stops, edges, termDate, termCredits } = plan;
  const tree = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  const [sel, setSel] = useState<string | null>(null);
  const [ripple, setRipple] = useState<{ key: number; depth: Map<string, number>; unlocked: Set<string> } | null>(null);
  const moved = useRef<string | null>(null);
  const prevIssues = useRef(new Set(stops.filter((s) => s.issue).map((s) => s.item.id)));

  const onDrop = useCallback(
    (id: string, termId: string) => {
      moved.current = id;
      plan.move(id, termId);
    },
    [plan],
  );
  const { drag, start } = useDrag(onDrop);
  const shift = useCallback(
    (id: string, by: number) => {
      moved.current = id;
      plan.shift(id, by);
    },
    [plan],
  );

  const measure = useCallback(() => {
    const t = tree.current;
    if (!t) return;
    const tr = t.getBoundingClientRect();
    const m = new Map<string, Box>();
    t.querySelectorAll<HTMLElement>("[data-stop]").forEach((n) => {
      const r = n.getBoundingClientRect();
      m.set(n.dataset.stop!, { x: r.left - tr.left + r.width / 2, top: r.top - tr.top, bottom: r.bottom - tr.top });
    });
    setBoxes(m);
  }, []);
  useLayoutEffect(measure, [measure, terms]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (tree.current) ro.observe(tree.current);
    return () => ro.disconnect();
  }, [measure]);

  // After a move: light the chain downstream of the moved course, and tag anything that just unlocked.
  useEffect(() => {
    const issuesNow = new Set(stops.filter((s) => s.issue).map((s) => s.item.id));
    const unlocked = new Set([...prevIssues.current].filter((id) => !issuesNow.has(id)));
    prevIssues.current = issuesNow;
    const origin = moved.current;
    moved.current = null;
    if (!origin) return;
    const depth = new Map([[origin, 0]]);
    const queue = [origin];
    while (queue.length) {
      const id = queue.shift()!;
      edges.filter((e) => e.from === id && !depth.has(e.to)).forEach((e) => {
        depth.set(e.to, depth.get(id)! + 1);
        queue.push(e.to);
      });
    }
    const raf = requestAnimationFrame(() => setRipple((r) => ({ key: (r?.key ?? 0) + 1, depth, unlocked })));
    return () => cancelAnimationFrame(raf);
  }, [stops, edges]);

  const route = useMemo(() => {
    if (!sel) return null;
    const ids = new Set([sel]);
    const walk = (id: string, up: boolean) =>
      edges.forEach((e) => {
        const [a, b] = up ? [e.to, e.from] : [e.from, e.to];
        if (a === id && !ids.has(b)) {
          ids.add(b);
          walk(b, up);
        }
      });
    walk(sel, true);
    walk(sel, false);
    return ids;
  }, [sel, edges]);

  const stopById = useMemo(() => new Map(stops.map((s) => [s.item.id, s])), [stops]);
  const chosen = stops.filter((s) => !s.placeholder).reduce((n, s) => n + s.credits, 0);
  const slots = stops.filter((s) => s.placeholder).reduce((n, s) => n + s.credits, 0);
  const locked = stops.filter((s) => s.issue).length;
  const dragStop = drag ? stopById.get(drag.itemId) : undefined;

  const node = (s: Stop) => {
    const d = ripple?.depth.get(s.item.id);
    return (
      <button
        key={s.item.id}
        type="button"
        className="ut-node"
        data-stop={s.item.id}
        data-ph={s.placeholder ? "" : undefined}
        data-locked={s.issue ? "" : undefined}
        data-key={s.critical && !s.placeholder ? "" : undefined}
        data-sel={sel === s.item.id ? "" : undefined}
        data-dim={route && !route.has(s.item.id) ? "" : undefined}
        style={{ ["--d" as string]: d ?? 0, opacity: drag?.itemId === s.item.id ? 0.25 : undefined }}
        onPointerDown={(e) => start(e, s.item.id)}
        onClick={() => setSel((v) => (v === s.item.id ? null : s.item.id))}
        onKeyDown={(e) => keyMove(e, s.item.id, shift)}
        aria-pressed={sel === s.item.id}
        aria-label={`${s.placeholder ? `Open slot: ${s.label}` : `${s.code}, ${s.label}`}, ${s.credits} hours${s.issue ? `. Locked: needs ${s.issue.join(" and ")} first` : ""}. Arrow keys move it.`}
      >
        {d !== undefined && <span className="ut-pulse" key={`p${ripple!.key}`} aria-hidden />}
        <span className="c">{s.placeholder ? "Open slot" : s.code}</span>
        <span className="h">{s.credits}</span>
        <span className="n">{s.label}</span>
        {s.issue && <span className="lk">Locked · needs {s.issue.join(" + ")}</span>}
        {ripple?.unlocked.has(s.item.id) && (
          <span className="un" key={ripple.key}>
            UNLOCKED
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="ut">
      <header className="ut-top">
        <div className="ut-row1">
          <div className="ut-title">
            Plotted
            <small>UT Austin · Computer Science BS</small>
          </div>
          <div className="ut-goal" role="status" aria-live="polite">
            Graduate <b>{plan.finish}</b>
            <span>
              {plan.open.length ? `${plan.open.length} requirements open` : "Every requirement covered"}
              {locked ? ` · ${locked} locked` : ""}
            </span>
          </div>
        </div>
        <div className="ut-xp" role="img" aria-label={`${chosen} hours of real courses and ${slots} hours of open slots, of ${plan.totalHours}`}>
          <b style={{ transform: `scaleX(${Math.min(1, (chosen + slots) / plan.totalHours)})` }} />
          <i style={{ transform: `scaleX(${Math.min(1, chosen / plan.totalHours)})` }} />
          <u />
        </div>
        <div className="ut-xplabels" aria-hidden>
          <span>{chosen} HRS CHOSEN · {slots} OPEN</span>
          <span>FRESHMAN</span>
          <span>SOPHOMORE</span>
          <span>JUNIOR</span>
          <span>SENIOR</span>
          <span>{plan.totalHours}</span>
        </div>
      </header>

      <div className="ut-tree" ref={tree}>
        <svg className="ut-svg" aria-hidden>
          {edges.map((e) => {
            const a = boxes.get(e.from);
            const b = boxes.get(e.to);
            if (!a || !b) return null;
            const p = edgePath(a, b);
            const hot = route?.has(e.from) && route.has(e.to);
            return <path key={`${e.from}>${e.to}`} d={p.d} className={p.bad ? "bad" : hot ? "hot" : "on"} />;
          })}
          {ripple &&
            edges
              .filter((e) => ripple.depth.has(e.from) && ripple.depth.has(e.to))
              .map((e) => {
                const a = boxes.get(e.from);
                const b = boxes.get(e.to);
                if (!a || !b) return null;
                const p = edgePath(a, b);
                return (
                  <path
                    key={`s${ripple.key}${e.from}>${e.to}`}
                    className="spark"
                    d={p.d}
                    style={{ ["--len" as string]: p.len, ["--d" as string]: ripple.depth.get(e.from)! + 0.4 }}
                  />
                );
              })}
        </svg>
        {terms.map((t, i) => (
          <section
            key={t.id}
            className="ut-tier"
            data-term-id={t.id}
            data-over={drag?.overTerm === t.id ? "" : undefined}
            aria-label={`${termDate(t)}, ${termCredits[t.id] ?? 0} hours`}
          >
            <div className="ut-tlabel">
              Tier {i + 1} · {termDate(t)}
              <span>{termCredits[t.id] ?? 0} hrs</span>
            </div>
            <div className="ut-nodes">{stops.filter((s) => s.termId === t.id).map(node)}</div>
          </section>
        ))}
      </div>

      <p className="ut-hint">
        Drag a course to another tier (or focus it and use ← →). Courses glow when their prerequisites are met; move one too early and it
        locks. Tap a course to trace its chain.
      </p>

      <section className="ut-panel" aria-label="Requirement progress">
        {plan.ev.areas.map((a) => {
          const r = a.result;
          const done = r.hours ? (r.hours.earned + r.hours.planned) / r.hours.required : r.count ? r.count.done / r.count.required : r.status === "met" || r.status === "planned" ? 1 : 0;
          const open = r.status === "unmet" || r.status === "partial";
          return (
            <div key={a.id} className="ut-quest">
              <b>
                {a.label.replace(/\s*\(.*\)/, "")}
                <em data-open={open ? "" : undefined}>{open ? "Open" : r.status === "planned" ? "Planned" : r.status === "manual" ? "Check" : "Done"}</em>
              </b>
              <span>
                {r.hours ? `${r.hours.earned + r.hours.planned} of ${r.hours.required} hrs` : r.count ? `${r.count.done} of ${r.count.required}` : ""}
              </span>
              <div className="ut-qbar" aria-hidden>
                <i style={{ transform: `scaleX(${Math.min(1, done)})` }} />
              </div>
            </div>
          );
        })}
      </section>

      {drag && dragStop && (
        <div className="proto-ghost ut-ghost" style={{ transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px)` }}>
          {dragStop.placeholder ? "Open slot" : dragStop.code}
        </div>
      )}
    </div>
  );
}
