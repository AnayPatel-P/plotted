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

/** Settled statuses stay quiet in lists; stamps are for what still needs attention. */
const QUIET: Status[] = ["met", "planned", "manual"];

export function StatusMark({
  status,
  fresh = false,
  size = "sm",
  quiet = false,
}: {
  status: Status;
  fresh?: boolean;
  size?: "sm" | "lg";
  /** In tree rows, settled statuses render as a plain glyph + word instead of a stamp. */
  quiet?: boolean;
}) {
  const s = STATUS[status];
  if (quiet && QUIET.includes(status)) {
    return (
      <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-label ${s.cls}`} title={s.hint}>
        <span aria-hidden>{s.glyph}</span>
        {s.word}
      </span>
    );
  }
  return (
    <span
      className={`stamp inline-flex shrink-0 items-center gap-1 whitespace-nowrap ${s.cls} ${size === "lg" ? "text-body-sm" : "text-label"}`}
      data-fresh={fresh}
      title={s.hint}
    >
      <span aria-hidden>{s.glyph}</span>
      {s.word}
    </span>
  );
}
