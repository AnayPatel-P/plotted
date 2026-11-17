import type { Status } from "@plotted/engine";

/** Each status has its own glyph + word, so color is never the only signal. */
export const STATUS: Record<Status, { glyph: string; word: string; cls: string; hint: string }> = {
  met: { glyph: "✓", word: "Met", cls: "text-go-text", hint: "Done with the courses in your plan" },
  planned: {
    glyph: "◌",
    word: "Planned",
    cls: "text-ink-soft",
    hint: "Covered only by placeholders — pick real courses to make it Met",
  },
  partial: { glyph: "◐", word: "Partial", cls: "text-alert-text", hint: "Some of it is covered" },
  unmet: { glyph: "✕", word: "Missing", cls: "text-alert-text", hint: "Nothing in your plan covers this yet" },
  manual: { glyph: "?", word: "Check", cls: "text-ink-soft", hint: "Plotted can't check this one — confirm with your advisor" },
};

export function StatusMark({
  status,
  fresh = false,
  size = "sm",
}: {
  status: Status;
  fresh?: boolean;
  size?: "sm" | "lg";
  quiet?: boolean;
}) {
  const s = STATUS[status];
  return (
    <span
      className={`status-word shrink-0 rounded-sm px-0.5 ${s.cls} ${size === "lg" ? "text-body-sm" : "text-caption"}`}
      data-fresh={fresh}
      title={s.hint}
    >
      <span aria-hidden>{s.glyph}</span>
      {s.word}
    </span>
  );
}
