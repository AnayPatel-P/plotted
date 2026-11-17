import type { Status } from "@plotted/engine";

/** Each status has its own glyph + word, so color is never the only signal. */
export const STATUS: Record<Status, { glyph: string; word: string; cls: string; hint: string }> = {
  met: { glyph: "✓", word: "Met", cls: "text-blue-text", hint: "Done with the courses in your plan" },
  planned: {
    glyph: "◌",
    word: "Planned",
    cls: "text-violet-text",
    hint: "Covered only by placeholder slots — pick real courses to make it Met",
  },
  partial: { glyph: "◐", word: "Partial", cls: "text-on-yellow bg-yellow", hint: "Some of it is covered" },
  unmet: { glyph: "✕", word: "Missing", cls: "text-pink-text", hint: "Nothing in your plan covers this yet" },
  manual: { glyph: "?", word: "Check", cls: "text-ink-soft", hint: "Plotted can't check this one — confirm with your advisor" },
};

export function StatusMark({ status, fresh = false, size = "sm" }: { status: Status; fresh?: boolean; size?: "sm" | "lg" }) {
  const s = STATUS[status];
  return (
    <span
      className={`stamp inline-flex shrink-0 items-center gap-1 whitespace-nowrap ${s.cls} ${size === "lg" ? "text-sm" : "text-[11px]"}`}
      data-fresh={fresh}
      title={s.hint}
    >
      <span aria-hidden>{s.glyph}</span>
      {s.word}
    </span>
  );
}
