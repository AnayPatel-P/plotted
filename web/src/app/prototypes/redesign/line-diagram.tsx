"use client";

import type { Course, Program } from "@plotted/engine";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { keyMove, LINES, type LineId, type Stop, useDrag, usePlan } from "./model";

const CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·-/";

/** A row of split-flap cells. Changed characters riffle through a few flaps, left to right; a new target interrupts cleanly. */
function FlapText({ text, len, hot }: { text: string; len: number; hot?: boolean }) {
  const target = text.toUpperCase().padEnd(len).slice(0, len);
  const cur = useRef<string[]>(Array.from({ length: len }, () => " "));
  const [cells, setCells] = useState(() => Array.from({ length: len }, () => ({ ch: " ", n: 0 })));

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const set = (i: number, c: string) => {
      cur.current[i] = c;
      setCells((prev) => prev.map((p, j) => (j === i ? { ch: c, n: p.n + 1 } : p)));
    };
    [...target].forEach((ch, i) => {
      if (cur.current[i] === ch) return;
      if (reduce) return void timers.push(setTimeout(() => set(i, ch), 0));
      const ti = Math.max(0, CHARS.indexOf(ch));
      const steps = [...Array(4)].map((_, k) => CHARS[(ti - 4 + k + CHARS.length) % CHARS.length]!).concat(ch);
      steps.forEach((c, k) => timers.push(setTimeout(() => set(i, c), i * 26 + k * 60)));
    });
    return () => timers.forEach(clearTimeout);
  }, [target]);

  return (
    <span className="flap-cells" aria-hidden>
      {cells.map((c, i) => (
        <span key={i} className={`flap${c.n ? " is-flipping" : ""}`} data-hot={hot ? "" : undefined}>
          <span key={c.n}>{c.ch}</span>
        </span>
      ))}
    </span>
  );
}

type Pt = { x: number; y: number };

/** Vignelli routing: horizontal, one 45° diagonal, horizontal. */
function track(a: Pt, b: Pt): string {
  const dy = b.y - a.y;
  const run = b.x - a.x;
  if (run <= Math.abs(dy) + 24) return `M${a.x} ${a.y} L${b.x} ${b.y}`;
  const x1 = a.x + (run - Math.abs(dy)) / 2;
  return `M${a.x} ${a.y} H${x1} L${x1 + Math.abs(dy)} ${b.y} H${b.x}`;
}

export function LineDiagram({ program, courses }: { program: Program; courses: Course[] }) {
  const plan = usePlan(program, courses);
  const { terms, stops, edges, termDate, termCredits } = plan;
  const grid = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<Map<string, Pt>>(new Map());
  const [sel, setSel] = useState<string | null>(null);
  const { drag, start } = useDrag(plan.move);
  const [initialFinish] = useState(plan.finish);

  const measure = useCallback(() => {
    const g = grid.current;
    if (!g) return;
    const gr = g.getBoundingClientRect();
    const m = new Map<string, Pt>();
    g.querySelectorAll<HTMLElement>("[data-dot]").forEach((d) => {
      const r = d.getBoundingClientRect();
      m.set(d.dataset.dot!, { x: r.left - gr.left + r.width / 2, y: r.top - gr.top + r.height / 2 });
    });
    setPts(m);
  }, []);
  useLayoutEffect(measure, [measure, terms]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (grid.current) ro.observe(grid.current);
    return () => ro.disconnect();
  }, [measure]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const termIndex = useMemo(() => new Map(terms.map((t, i) => [t.id, i])), [terms]);
  const stopById = useMemo(() => new Map(stops.map((s) => [s.item.id, s])), [stops]);

  // whole route (upstream + downstream) of the selected course
  const route = useMemo(() => {
    if (!sel) return null;
    const ids = new Set([sel]);
    const walk = (id: string, dir: "up" | "down") =>
      edges.forEach((e) => {
        const [a, b] = dir === "up" ? [e.to, e.from] : [e.from, e.to];
        if (a === id && !ids.has(b)) {
          ids.add(b);
          walk(b, dir);
        }
      });
    walk(sel, "up");
    walk(sel, "down");
    return ids;
  }, [sel, edges]);

  // Lines: one horizontal run per lane through each term's first stop, plus a station capsule per multi-stop term.
  const lineGeom = useMemo(() => {
    return LINES.map((l) => {
      const byTerm = new Map<number, Pt[]>();
      stops
        .filter((s) => s.line === l.id && pts.has(s.item.id))
        .forEach((s) => byTerm.set(s.termIndex, [...(byTerm.get(s.termIndex) ?? []), pts.get(s.item.id)!]));
      const keys = [...byTerm.keys()].sort((a, b) => a - b);
      const heads = keys.map((k) => byTerm.get(k)![0]!);
      const run = heads.length > 1 ? `M${heads[0]!.x} ${heads[0]!.y} ${heads.slice(1).map((p) => `L${p.x} ${p.y}`).join(" ")}` : "";
      const caps = keys
        .map((k) => byTerm.get(k)!)
        .filter((ps) => ps.length > 1)
        .map((ps) => `M${ps[0]!.x} ${ps[0]!.y} L${ps.at(-1)!.x} ${ps.at(-1)!.y}`);
      return { id: l.id, run, caps };
    });
  }, [stops, pts]);

  // Live tracks while dragging: from the ghost to its prerequisites and dependents.
  const gridRect = drag ? document.querySelector(".ld-grid")?.getBoundingClientRect() : undefined;
  const liveTracks = useMemo(() => {
    if (!drag || !gridRect) return [];
    const g = { x: drag.x - gridRect.left, y: drag.y - gridRect.top };
    const at = drag.overTerm != null ? termIndex.get(drag.overTerm) : undefined;
    return edges.flatMap((e) => {
      if (e.to === drag.itemId && pts.has(e.from)) {
        const from = stopById.get(e.from)!;
        const bad = at !== undefined && (e.concurrent ? at < from.termIndex : at <= from.termIndex);
        return [{ d: track(pts.get(e.from)!, g), bad, key: `u${e.from}` }];
      }
      if (e.from === drag.itemId && pts.has(e.to)) {
        const to = stopById.get(e.to)!;
        const bad = at !== undefined && (e.concurrent ? to.termIndex < at : to.termIndex <= at);
        return [{ d: track(g, pts.get(e.to)!), bad, key: `d${e.to}` }];
      }
      return [];
    });
  }, [drag, gridRect, edges, pts, stopById, termIndex]);

  const routeTracks = useMemo(() => {
    if (!route || drag) return [];
    return edges
      .filter((e) => route.has(e.from) && route.has(e.to) && pts.has(e.from) && pts.has(e.to))
      .map((e) => ({ d: track(pts.get(e.from)!, pts.get(e.to)!), bad: false, key: `${e.from}>${e.to}` }));
  }, [route, drag, edges, pts]);

  const issueTracks = useMemo(() => {
    if (drag) return [];
    return edges
      .filter((e) => stopById.get(e.to)?.issue && pts.has(e.from) && pts.has(e.to))
      .map((e) => ({ d: track(pts.get(e.from)!, pts.get(e.to)!), bad: true, key: `x${e.from}>${e.to}` }));
  }, [drag, edges, stopById, pts]);

  const delays = plan.sched.delays.length;
  const alerts = plan.ev.prereqIssues.length;
  const service = delays ? `${delays} DELAYS` : alerts ? `${alerts} ALERTS` : plan.open.length ? `${plan.open.length} GAPS` : "GOOD SERVICE";
  const selStop = sel ? stopById.get(sel) : undefined;
  const selSched = sel ? plan.sched.items.get(sel) : undefined;
  const lineColor = (id: LineId) => `var(--${id})`;
  const dragStop = drag ? stopById.get(drag.itemId) : undefined;

  const renderStop = (s: Stop) => (
    <button
      key={s.item.id}
      type="button"
      className="ld-stop"
      data-stop={s.item.id}
      data-ph={s.placeholder ? "" : undefined}
      data-issue={s.issue ? "" : undefined}
      data-sel={sel === s.item.id ? "" : undefined}
      data-dim={route && !route.has(s.item.id) ? "" : undefined}
      style={{ ["--c" as string]: lineColor(s.line), opacity: drag?.itemId === s.item.id ? 0.25 : undefined }}
      onPointerDown={(e) => start(e, s.item.id)}
      onClick={() => setSel((v) => (v === s.item.id ? null : s.item.id))}
      onKeyDown={(e) => keyMove(e, s.item.id, plan.shift)}
      aria-pressed={s.placeholder ? undefined : sel === s.item.id}
      aria-label={`${s.placeholder ? `Placeholder: ${s.label}` : `${s.code}, ${s.label}`}, ${s.credits} hours, ${termDate(terms[s.termIndex]!)}${s.issue ? `. Needs ${s.issue.join(" and ")} first` : ""}. Arrow keys move it.`}
    >
      <span className="ld-dot" data-dot={s.item.id} />
      <span>
        <span className="ld-code">
          {s.placeholder ? s.label : s.code}
          {s.critical && !s.placeholder && <span className="ld-key">KEY</span>}
        </span>
        {!s.placeholder && <span className="ld-name">{s.label}</span>}
        {s.issue && <span className="ld-alert">✕ Needs {s.issue.join(" and ")}</span>}
      </span>
    </button>
  );

  return (
    <div className="ld">
      <header className="ld-top">
        <div className="ld-brand">
          <b>Plotted</b>
          <span>UT Austin · Computer Science BS · 2026–28 catalog</span>
        </div>
        <div className="flap-board" role="status" aria-live="polite">
          <span className="sr-only">
            Graduating {plan.finish}. {plan.hours} of {plan.totalHours} hours planned.{" "}
            {plan.open.length ? `${plan.open.length} requirements open.` : "Every requirement covered."}
          </span>
          <div className="flap-row">
            <span className="flap-key" aria-hidden>ARRIVING</span>
            <FlapText text={plan.finish ?? ""} len={11} hot={plan.finish !== initialFinish} />
          </div>
          <div className="flap-row">
            <span className="flap-key" aria-hidden>ON BOARD</span>
            <FlapText text={`${plan.hours}/${plan.totalHours} HRS`} len={11} />
          </div>
          <div className="flap-row">
            <span className="flap-key" aria-hidden>SERVICE</span>
            <FlapText text={service} len={11} hot={!!plan.open.length || !!delays} />
          </div>
        </div>
      </header>

      <div className="ld-scroll">
        <div className="ld-grid" ref={grid} style={{ ["--n" as string]: terms.length }}>
          <svg className="ld-svg" aria-hidden>
            {lineGeom.map((g) => (
              <g key={g.id} style={{ stroke: lineColor(g.id), opacity: route ? 0.25 : 1 }}>
                {g.run && <path className="line" d={g.run} />}
                {g.caps.map((d, i) => (
                  <path key={i} className="cap" d={d} />
                ))}
              </g>
            ))}
            {[...issueTracks, ...routeTracks].map((t) => (
              <path key={t.key} className={`track${t.bad ? " bad" : ""}`} d={t.d} />
            ))}
            {liveTracks.map((t) => (
              <path key={t.key} className={`track live${t.bad ? " bad" : ""}`} d={t.d} />
            ))}
          </svg>

          <div className="ld-corner">Lines ↓ · Semesters →</div>
          {terms.map((t) => {
            const hrs = termCredits[t.id] ?? 0;
            return (
              <div key={t.id} className="ld-head" data-term-id={t.id} data-over={drag?.overTerm === t.id ? "" : undefined}>
                <div className="t">{termDate(t).replace(/ 20(\d\d)/, " ’$1").toUpperCase()}</div>
                <div className="y">
                  {t.label.split(" · ")[0]} · {hrs} hrs
                </div>
                <div className="ld-load" aria-hidden>
                  <i data-heavy={hrs > 17 ? "" : undefined} style={{ transform: `scaleX(${Math.min(1, hrs / 18)})` }} />
                </div>
              </div>
            );
          })}

          {LINES.map((l) => {
            const mine = stops.filter((s) => s.line === l.id);
            if (!mine.length) return null;
            return [
              <div key={l.id} className="ld-lane" style={{ ["--c" as string]: lineColor(l.id) }}>
                <span className="ld-bullet" aria-hidden>
                  {l.short}
                </span>
                <span>
                  <b>{l.name}</b>
                  <small>
                    {mine.length} stops · {mine.reduce((n, s) => n + s.credits, 0)} hrs
                  </small>
                </span>
              </div>,
              ...terms.map((t) => (
                <div key={`${l.id}-${t.id}`} className="ld-cell" data-term-id={t.id} data-over={drag?.overTerm === t.id ? "" : undefined}>
                  <div className="ld-stops">{mine.filter((s) => s.termId === t.id).map(renderStop)}</div>
                </div>
              )),
            ];
          })}
        </div>
      </div>

      <p className="ld-hint">
        Drag a stop to another semester (or focus it and use ← →). Tap a stop to trace its route. Black tracks are prerequisites; a
        dashed red track runs backwards.
      </p>

      <section className="ld-status" aria-label="Requirement status">
        <h2>Service status</h2>
        {plan.ev.areas.map((a) => {
          const l = LINES.find((x) => x.area === a.id);
          const r = a.result;
          const short = r.hours ? Math.max(0, r.hours.required - r.hours.earned - r.hours.planned) : 0;
          const s = r.status === "met" ? "good" : r.status === "planned" ? "planned" : r.status === "manual" ? "check" : "gap";
          return (
            <div key={a.id} className="ld-svc">
              <span className="ld-bullet" style={{ ["--c" as string]: l ? lineColor(l.id) : "var(--ink)" }} aria-hidden>
                {l?.short ?? "Σ"}
              </span>
              <span>
                <b>{a.label.replace(/\s*\(.*\)/, "")}</b>
                <span>
                  <em data-s={s}>
                    {s === "good" ? "Good service" : s === "planned" ? "Planned work" : s === "check" ? "Check with advisor" : "Service gap"}
                  </em>
                  {r.hours ? ` · ${r.hours.earned + r.hours.planned}/${r.hours.required} hrs` : ""}
                  {short ? ` · ${short} short` : ""}
                </span>
              </span>
            </div>
          );
        })}
      </section>

      {selStop && !selStop.placeholder && selSched && (
        <aside className="ld-card" style={{ ["--c" as string]: lineColor(selStop.line) }} aria-live="polite">
          <h3>{selStop.code}</h3>
          <p>{selStop.label}</p>
          <p>
            <b>Builds on:</b>{" "}
            {edges.filter((e) => e.to === sel).map((e) => stopById.get(e.from)?.code).join(", ") || "nothing in your plan"}
            <br />
            <b>Leads to:</b> {edges.filter((e) => e.from === sel).map((e) => stopById.get(e.to)?.code).join(", ") || "nothing in your plan"}
            <br />
            <b>Timing:</b>{" "}
            {selSched.slack > 0
              ? `can slip ${selSched.slack} semester${selSched.slack === 1 ? "" : "s"}`
              : selSched.critical
                ? "no slack — later delays graduation"
                : "in your final stretch"}
          </p>
        </aside>
      )}

      {drag && dragStop && (
        <div
          className="proto-ghost ld-ghost"
          style={{ ["--c" as string]: lineColor(dragStop.line), transform: `translate(${drag.x - 12}px, ${drag.y - 14}px)` }}
        >
          <span className="ld-dot" />
          {dragStop.placeholder ? dragStop.label : dragStop.code}
        </div>
      )}
    </div>
  );
}
