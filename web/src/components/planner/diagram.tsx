"use client";

import { useDroppable } from "@dnd-kit/core";
import type { Evaluation, PrereqEdge, Program, RuleResult, Term } from "@plotted/engine";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/* Lines: one per requirement area (total hours excluded), plus Electives */
/* ------------------------------------------------------------------ */

export interface Line {
  id: string;
  /** "1", "2", … or "E" — what the bullet shows. */
  mark: string;
  name: string;
  color: string;
  /** Numeral color on the bullet. */
  on: string;
}

const ELECTIVES = "__electives";

export function linesFor(program: Program): Line[] {
  const areas = [...program.areas.filter((a) => a.exclusive), ...program.areas.filter((a) => !a.exclusive)].filter(
    (a) => a.id !== "total",
  );
  return [
    ...areas.slice(0, 6).map((a, i) => ({
      id: a.id,
      mark: String(i + 1),
      name: a.label.replace(/\s*\(.*\)\s*$/, ""),
      color: `var(--line-${i + 1})`,
      on: `var(--on-line-${i + 1})`,
    })),
    { id: ELECTIVES, mark: "E", name: "Electives", color: "var(--line-e)", on: "var(--on-line-e)" },
  ];
}

/** Which line each plan item rides: the first area (exclusive ones first) it counts toward. */
export function lineAssignments(lines: Line[], ev: Evaluation): Map<string, Line> {
  const ruleArea = new Map<string, string>();
  const walk = (r: RuleResult, area: string) => {
    ruleArea.set(r.id, area);
    r.children?.forEach((c) => walk(c, area));
  };
  ev.areas.forEach((a) => walk(a.result, a.id));
  const out = new Map<string, Line>();
  const electives = lines.at(-1)!;
  for (const [itemId, rules] of Object.entries(ev.itemRules)) {
    const areas = new Set(rules.map((r) => ruleArea.get(r)));
    out.set(itemId, lines.find((l) => areas.has(l.id)) ?? electives);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

type Pt = { x: number; y: number };

/** Vignelli routing: horizontal, one 45° diagonal, horizontal. Backwards runs go straight. */
function track(a: Pt, b: Pt): string {
  const dy = b.y - a.y;
  const run = b.x - a.x;
  if (Math.abs(run) < 2) return `M${a.x} ${a.y} V${b.y}`;
  if (run <= Math.abs(dy) + 24) return `M${a.x} ${a.y} L${b.x} ${b.y}`;
  const x1 = a.x + (run - Math.abs(dy)) / 2;
  return `M${a.x} ${a.y} H${x1} L${x1 + Math.abs(dy)} ${b.y} H${b.x}`;
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

function TermColumn({
  term,
  label,
  status,
  over,
  children,
}: {
  term: Term;
  label: string;
  status?: string;
  over: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: term.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-status={status}
      data-over={over ? "" : undefined}
      className="term col"
    >
      {children}
    </section>
  );
}

export interface DiagramProps {
  terms: Term[];
  lines: Line[];
  lineOf: Map<string, Line>;
  /** Region label + data-status for each term column. */
  termMeta: (t: Term) => { label: string; status?: string };
  renderHead: (t: Term) => ReactNode;
  renderFoot: (t: Term) => ReactNode;
  renderStop: (itemId: string, t: Term, line: Line, laneIndex: number) => ReactNode;
  addColumn?: ReactNode;
  /** Prerequisite links to draw as track (the selected course's route). */
  routeEdges: PrereqEdge[];
  /** Links that run backwards (prerequisite after the course). */
  badEdges: PrereqEdge[];
  /** While dragging: the item, the pointer, and the column under it. */
  drag: { itemId: string; point: Pt | null; overTermId: string | null } | null;
  allEdges: PrereqEdge[];
  /** Re-measure when this changes (selection opens a panel under a stop). */
  layoutKey: string;
}

export function Diagram(p: DiagramProps) {
  const board = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<Map<string, Pt>>(new Map());
  const [origin, setOrigin] = useState<{ left: number; top: number; strip: boolean }>({ left: 0, top: 0, strip: false });

  const measure = useCallback(() => {
    const b = board.current;
    if (!b) return;
    const br = b.getBoundingClientRect();
    const m = new Map<string, Pt>();
    b.querySelectorAll<HTMLElement>("[data-dot]").forEach((d) => {
      const r = d.getBoundingClientRect();
      if (!r.width) return;
      m.set(d.dataset.dot!, { x: r.left - br.left + r.width / 2, y: r.top - br.top + r.height / 2 });
    });
    setPts(m);
    setOrigin({ left: br.left, top: br.top, strip: getComputedStyle(b).display !== "grid" });
  }, []);

  useLayoutEffect(measure, [measure, p.terms, p.layoutKey, p.lines]);
  useEffect(() => {
    const b = board.current;
    if (!b) return;
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    const onScroll = () => {
      const r = b.getBoundingClientRect();
      setOrigin((o) => (o.left === r.left && o.top === r.top ? o : { ...o, left: r.left, top: r.top }));
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [measure]);

  const shownLines = useMemo(() => {
    const used = new Set(p.terms.flatMap((t) => t.items.map((i) => p.lineOf.get(i.id)?.id ?? ELECTIVES)));
    const list = p.lines.filter((l) => used.has(l.id));
    return list.length ? list : p.lines.slice(0, 1);
  }, [p.lines, p.lineOf, p.terms]);

  // Items in each term, grouped by lane, in plan order.
  const termIndex = useMemo(() => new Map(p.terms.map((t, i) => [t.id, i])), [p.terms]);
  const cells = useMemo(
    () =>
      p.terms.map((t) =>
        shownLines.map((l) => t.items.filter((i) => (p.lineOf.get(i.id)?.id ?? ELECTIVES) === l.id)),
      ),
    [p.terms, shownLines, p.lineOf],
  );

  // Each line: one run through the first stop of every station it serves, plus a capsule
  // joining stops in the same station. On phones (strip map) it's one vertical rail.
  const lineGeom = useMemo(
    () =>
      shownLines.map((l, li) => {
        const stations = cells
          .map((row) => row[li]!.map((i) => pts.get(i.id)).filter((x): x is Pt => !!x))
          .filter((s) => s.length);
        if (origin.strip) {
          const all = stations.flat().sort((a, b) => a.y - b.y);
          return { id: l.id, color: l.color, run: all.length > 1 ? `M${all[0]!.x} ${all[0]!.y} V${all.at(-1)!.y}` : "", caps: [] };
        }
        const heads = stations.map((s) => s[0]!);
        const run = heads.length > 1 ? `M${heads[0]!.x} ${heads[0]!.y} ${heads.slice(1).map((h) => `L${h.x} ${h.y}`).join(" ")}` : "";
        const caps = stations.filter((s) => s.length > 1).map((s) => `M${s[0]!.x} ${s[0]!.y} V${s.at(-1)!.y}`);
        return { id: l.id, color: l.color, run, caps };
      }),
    [shownLines, cells, pts, origin.strip],
  );

  const ghost = p.drag?.point ? { x: p.drag.point.x - origin.left, y: p.drag.point.y - origin.top } : null;
  const at = p.drag?.overTermId != null ? termIndex.get(p.drag.overTermId) : undefined;
  const termOf = (itemId: string) => p.terms.findIndex((t) => t.items.some((i) => i.id === itemId));
  const live = p.drag && ghost
    ? p.allEdges.flatMap((e) => {
        if (e.to === p.drag!.itemId && pts.has(e.from)) {
          const ft = termOf(e.from);
          const bad = at !== undefined && (e.concurrent ? at < ft : at <= ft);
          return [{ key: `u${e.from}`, d: track(pts.get(e.from)!, ghost), bad }];
        }
        if (e.from === p.drag!.itemId && pts.has(e.to)) {
          const tt = termOf(e.to);
          const bad = at !== undefined && (e.concurrent ? tt < at : tt <= at);
          return [{ key: `d${e.to}`, d: track(ghost, pts.get(e.to)!), bad }];
        }
        return [];
      })
    : [];
  const fixed = p.drag
    ? []
    : [
        ...p.badEdges.map((e) => ({ e, bad: true })),
        ...p.routeEdges.filter((e) => !p.badEdges.includes(e)).map((e) => ({ e, bad: false })),
      ].flatMap(({ e, bad }) =>
        pts.has(e.from) && pts.has(e.to) ? [{ key: `${e.from}>${e.to}`, d: track(pts.get(e.from)!, pts.get(e.to)!), bad }] : [],
      );
  const dimLines = p.routeEdges.length > 0 && !p.drag;

  return (
    <div className="board-scroll">
      <div
        ref={board}
        className="board"
        style={{ ["--terms" as string]: p.terms.length, ["--lanes" as string]: shownLines.length }}
      >
        <svg className="diagram-svg" aria-hidden>
          {lineGeom.map((g) => (
            <g key={g.id} style={{ stroke: g.color, opacity: dimLines ? 0.25 : 1 }}>
              {g.run && <path className="line" d={g.run} />}
              {g.caps.map((d, i) => (
                <path key={i} className="station" d={d} />
              ))}
            </g>
          ))}
          {fixed.map((t) => (
            <path key={t.key} className="track" data-bad={t.bad ? "" : undefined} d={t.d} />
          ))}
          {live.map((t) => (
            <path key={t.key} className="track" data-live="" data-bad={t.bad ? "" : undefined} d={t.d} />
          ))}
        </svg>

        <div className="col lane-col" aria-hidden>
          <div className="term-head flex items-end pb-3 font-mono text-label text-ink-soft uppercase">Lines</div>
          {shownLines.map((l) => {
            const items = p.terms.flatMap((t) => t.items).filter((i) => (p.lineOf.get(i.id)?.id ?? ELECTIVES) === l.id);
            return (
              <div key={l.id} className="lane-label">
                <span className="bullet" style={{ ["--c" as string]: l.color, ["--on" as string]: l.on }}>
                  {l.mark}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-body-sm leading-tight font-bold">{l.name}</span>
                  <span className="mt-0.5 block font-mono text-label text-ink-soft">
                    {items.length} stop{items.length === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
            );
          })}
          <div />
        </div>

        {p.terms.map((t, ti) => {
          const meta = p.termMeta(t);
          return (
            <TermColumn key={t.id} term={t} label={meta.label} status={meta.status} over={p.drag?.overTermId === t.id}>
              <header className="term-head">{p.renderHead(t)}</header>
              {shownLines.map((l, li) => (
                <ul key={l.id} className="lane-cell flex flex-col gap-2.5" aria-label={`${l.name} line`}>
                  {cells[ti]![li]!.map((i) => p.renderStop(i.id, t, l, li))}
                </ul>
              ))}
              <footer className="term-foot">{p.renderFoot(t)}</footer>
            </TermColumn>
          );
        })}

        {p.addColumn && <div className="col add-col">{p.addColumn}</div>}
      </div>
    </div>
  );
}
