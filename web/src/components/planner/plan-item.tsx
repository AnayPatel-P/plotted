"use client";

import { useDraggable } from "@dnd-kit/core";
import type { Course, DelayWarning, ItemSchedule, PlanItem, PrereqIssue, Term } from "@plotted/engine";

export type RouteRole = "self" | "up" | "down" | "dim" | undefined;

interface Props {
  item: PlanItem;
  course?: Course;
  issue?: PrereqIssue;
  schedule?: ItemSchedule;
  delay?: DelayWarning;
  route: RouteRole;
  highlighted: boolean;
  selected: boolean;
  terms: Term[];
  termId: string;
  onSelect: () => void;
  onFillSlot: () => void;
  onMove: (toTermId: string) => void;
  onRemove: () => void;
  routeSummary?: { needs: string[]; unlocks: string[]; slack: number };
}

/** Ink color for a sticker's misregistered shadow, varied per subject so the grid reads like a print. */
function inkFor(subject: string) {
  const inks = ["var(--pink)", "var(--blue)", "var(--violet)", "var(--yellow)"];
  let h = 0;
  for (const ch of subject) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return inks[h % inks.length];
}

export function PlanItemChip(props: Props) {
  const { item, course, issue, schedule, delay, route, highlighted, selected, terms, termId } = props;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { termId } });

  const isSlot = item.kind === "slot";
  const subject = item.kind === "course" ? item.code.slice(0, item.code.lastIndexOf(" ")) : "";
  const credits = item.kind === "slot" ? item.credits : (course?.credits ?? "?");
  const label = item.kind === "slot" ? item.label : item.code;

  const routeStyle =
    route === "self"
      ? "ring-4 ring-yellow"
      : route === "up"
        ? "ring-2 ring-blue"
        : route === "down"
          ? "ring-2 ring-pink"
          : route === "dim"
            ? "opacity-35"
            : "";

  return (
    <li
      ref={setNodeRef}
      data-item-id={item.id}
      className={`relative transition-opacity ${isDragging ? "opacity-30" : ""}`}
      style={{ ["--sticker-ink" as string]: isSlot ? "transparent" : inkFor(subject) }}
    >
      <div
        className={`${isSlot ? "punchout" : "sticker"} group relative ${routeStyle} ${highlighted ? "outline-3 outline-offset-2 outline-yellow" : ""}`}
      >
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-pressed={isSlot ? undefined : selected}
          aria-label={
            isSlot
              ? `Placeholder: ${item.label}, ${credits} hours. Choose a course.`
              : `${item.code} ${course?.title ?? ""}, ${credits} hours${issue ? `, needs ${issue.missing.join(" and ")} first` : ""}${
                  delay ? `, delays graduation` : schedule?.critical ? ", on the critical path" : ""
                }`
          }
          onClick={isSlot ? props.onFillSlot : props.onSelect}
          className="block w-full cursor-grab touch-manipulation px-2.5 py-1.5 text-left active:cursor-grabbing"
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className={isSlot ? "text-[13px] leading-tight font-medium text-ink-soft" : "font-mono text-[13px] font-medium"}>
              {label}
              {schedule?.critical && !delay && (
                <span
                  className="ml-1.5 inline-block -translate-y-px rounded-sm bg-yellow px-1 align-middle font-mono text-[9px] tracking-wider text-on-yellow uppercase"
                  title="No slack: taking this later delays graduation"
                >
                  ◆ no slack
                </span>
              )}
            </span>
            <span className="font-mono text-xs text-ink-soft tabular-nums">{credits}</span>
          </span>
          {!isSlot && (
            <span className="mt-0.5 block truncate text-[12px] leading-snug text-ink-soft">
              {course?.title ?? "Not in this catalog"}
            </span>
          )}
          {isSlot && <span className="mt-0.5 block text-[11px] font-medium text-violet-text">＋ pick a course</span>}
          {delay && (
            <span className="mt-1 flex items-start gap-1 text-[11px] leading-tight font-medium text-pink-text">
              <span aria-hidden>▲</span>
              <span>
                Delays graduation: {delay.chain.length - 1} course{delay.chain.length === 2 ? "" : "s"} after it need{" "}
                {delay.termsNeeded} more semester{delay.termsNeeded === 1 ? "" : "s"}
              </span>
            </span>
          )}
          {issue && (
            <span className="mt-1 flex items-start gap-1 text-[11px] leading-tight font-medium text-pink-text">
              <span aria-hidden>✕</span>
              <span>Needs first: {issue.missing.join("; ")}</span>
            </span>
          )}
        </button>
      </div>

      {selected && !isSlot && (
        <div className="relative z-20 mt-1.5 rounded-chip border-2 border-ink bg-card p-2 text-[12px] shadow-[3px_3px_0_0_var(--blue)]">
          {props.routeSummary && (
            <p className="mb-2 leading-snug">
              <span className="font-medium text-blue-text">Builds on:</span>{" "}
              {props.routeSummary.needs.length ? props.routeSummary.needs.join(", ") : "nothing in your plan"}
              <br />
              <span className="font-medium text-pink-text">Leads to:</span>{" "}
              {props.routeSummary.unlocks.length
                ? props.routeSummary.unlocks.slice(0, 8).join(", ") +
                  (props.routeSummary.unlocks.length > 8 ? ` +${props.routeSummary.unlocks.length - 8} more` : "")
                : "nothing in your plan"}
              <br />
              <span className="font-medium">Timing:</span>{" "}
              {props.routeSummary.slack > 0
                ? `could move ${props.routeSummary.slack} semester${props.routeSummary.slack === 1 ? "" : "s"} later without delaying graduation`
                : props.routeSummary.slack === 0
                  ? props.routeSummary.unlocks.length
                    ? "no slack — taking it later delays graduation"
                    : "in your final stretch"
                  : "already too late for the courses after it"}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="sr-only">Move {item.kind === "course" ? item.code : ""} to</span>
              <select
                aria-label={`Move ${item.kind === "course" ? item.code : ""} to another semester`}
                className="rounded-md border-2 border-ink bg-paper px-1.5 py-1 font-medium"
                value={termId}
                onChange={(e) => props.onMove(e.target.value)}
              >
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id === termId ? `In ${t.label}` : `Move to ${t.label}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={props.onRemove}
              className="rounded-md border-2 border-ink px-2 py-1 font-medium hover:bg-pink hover:text-on-yellow"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
