"use client";

import type { PrereqEdge } from "@plotted/engine";
import { type RefObject, useLayoutEffect, useState } from "react";

interface Line {
  key: string;
  d: string;
  len: number;
  kind: "up" | "down";
}

/**
 * The signature moment: when a course is selected, draw its prerequisite
 * route as ink lines between stickers — blue for what it needs, pink for
 * what it unlocks. Lines are measured from the rendered chips.
 */
export function RouteOverlay({
  container,
  edges,
  downstream,
  version,
}: {
  container: RefObject<HTMLElement | null>;
  edges: PrereqEdge[];
  downstream: Set<string>;
  version: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const root = container.current;
    if (!root) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const rect = (id: string) => {
        const el = root.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"] > div`);
        if (!el || el.offsetParent === null) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height };
      };
      const out: Line[] = [];
      for (const e of edges) {
        const a = rect(e.from);
        const b = rect(e.to);
        if (!a || !b) continue;
        const sameColumn = Math.abs(a.x - b.x) < 8;
        let d: string;
        if (sameColumn) {
          // Same column (stacked): loop out to the right.
          const x = a.x + a.w;
          const y1 = a.y + a.h / 2;
          const y2 = b.y + b.h / 2;
          d = `M ${x} ${y1} C ${x + 36} ${y1}, ${x + 36} ${y2}, ${x} ${y2}`;
        } else {
          const forward = b.x > a.x;
          const x1 = forward ? a.x + a.w : a.x;
          const x2 = forward ? b.x : b.x + b.w;
          const y1 = a.y + a.h / 2;
          const y2 = b.y + b.h / 2;
          const bend = Math.max(30, Math.abs(x2 - x1) * 0.45) * (forward ? 1 : -1);
          d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
        }
        const len = Math.hypot(b.x - a.x, b.y - a.y) * 1.6 + 80;
        out.push({ key: `${e.from}>${e.to}`, d, len, kind: downstream.has(e.to) ? "down" : "up" });
      }
      setLines(out);
      setSize({ w: root.scrollWidth, h: root.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [container, edges, downstream, version]);

  if (!lines.length) return null;
  return (
    <svg
      aria-hidden
      className="route-svg pointer-events-none absolute top-0 left-0 z-10 print:hidden"
      width={size.w}
      height={size.h}
    >
      {lines.map((l) => (
        <g key={l.key}>
          {/* misregistered under-pass */}
          <path
            d={l.d}
            className="route-path"
            style={{ ["--len" as string]: l.len, transform: "translate(2px, 2px)" }}
            stroke={l.kind === "up" ? "var(--pink)" : "var(--blue)"}
            strokeOpacity={0.45}
            strokeWidth={5}
          />
          <path
            d={l.d}
            className="route-path"
            style={{ ["--len" as string]: l.len }}
            stroke={l.kind === "up" ? "var(--blue)" : "var(--pink)"}
            strokeWidth={4}
          />
        </g>
      ))}
    </svg>
  );
}
