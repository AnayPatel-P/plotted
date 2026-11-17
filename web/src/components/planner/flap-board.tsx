"use client";

import { useEffect, useRef, useState } from "react";

const CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/·-";
const pad = (s: string, len: number) => s.toUpperCase().padEnd(len).slice(0, len);

/**
 * A row of split-flap cells. The first render shows the text as-is (static pages, no flash);
 * after that, each changed character riffles through a few flaps, left to right. A new target
 * mid-riffle cancels the old one and continues from what's on screen.
 */
function FlapText({ text, len, hot }: { text: string; len: number; hot?: boolean }) {
  const target = pad(text, len);
  const shown = useRef<string[]>([...target]);
  const [cells, setCells] = useState(() => [...target].map((ch) => ({ ch, n: 0 })));

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const set = (i: number, c: string) => {
      shown.current[i] = c;
      setCells((prev) => prev.map((p, j) => (j === i ? { ch: c, n: p.n + 1 } : p)));
    };
    [...target].forEach((ch, i) => {
      if (shown.current[i] === ch) return;
      if (reduce) return void timers.push(setTimeout(() => set(i, ch), 0));
      const ti = Math.max(0, CHARS.indexOf(ch));
      const steps = [3, 2, 1].map((k) => CHARS[(ti - k + CHARS.length) % CHARS.length]!).concat(ch);
      steps.forEach((c, k) => timers.push(setTimeout(() => set(i, c), i * 24 + k * 60)));
    });
    return () => timers.forEach(clearTimeout);
  }, [target]);

  return (
    <span className="flap-cells" aria-hidden>
      {cells.map((c, i) => (
        <span key={i} className="flap" data-flip={c.n ? "" : undefined} data-hot={hot ? "" : undefined}>
          <span key={c.n}>{c.ch}</span>
        </span>
      ))}
    </span>
  );
}

export interface FlapRow {
  key: string;
  value: string;
  /** Changed from what the plan started with, or needs attention: shown in the focus color. */
  hot?: boolean;
}

/** The departure board. Screen readers get the plain sentence in `summary` instead of the cells. */
export function FlapBoard({ rows, len = 11, summary }: { rows: FlapRow[]; len?: number; summary: string }) {
  return (
    <div className="flap-board">
      <p className="sr-only">{summary}</p>
      {rows.map((r) => (
        <div key={r.key} className="flap-row">
          <span className="flap-key" aria-hidden>
            {r.key}
          </span>
          <FlapText text={r.value} len={len} hot={r.hot} />
        </div>
      ))}
    </div>
  );
}
