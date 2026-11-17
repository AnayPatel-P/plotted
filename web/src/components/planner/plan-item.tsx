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
  readOnly?: boolean;
}


export function PlanItemChip(props: Props) {
  const { item, course, issue, schedule, delay, route, highlighted, selected, terms, termId } = props;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { termId }, disabled: !!props.readOnly });

  const isSlot = item.kind === "slot";
  const credits = item.kind === "slot" ? item.credits : (course?.credits ?? "?");
  const label = item.kind === "slot" ? item.label : item.code;

  const routeStyle =
    route === "self"
      ? "ring-4 ring-yellow"
      : route === "up"
        ? "ring-2 ring-blue"
        : route === "down"
          ? "ring-2 ring-violet"
          : route === "dim"
            ? "saturate-0 [--sticker-ink:var(--rule)] border-rule! [&_.font-mono]:text-ink-soft"
            : "";

  return (
    <li
      ref={setNodeRef}
      data-item-id={item.id}
      className={`relative transition-opacity ${isDragging ? "opacity-30" : ""}`}
      // Neutral ink unless the course has a problem (pink = needs attention).
      style={{ ["--sticker-ink" as string]: isSlot ? "transparent" : issue || delay ? "var(--pink)" : "var(--shadow-ink)" }}
    >
      <div
        className={`${isSlot ? "punchout" : "sticker"} group relative ${routeStyle} ${highlighted ? "outline-3 outline-offset-2 outline-yellow" : ""}`}
      >
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-pressed={isSlot ? undefined : selected}
          onClick={isSlot ? (props.readOnly ? undefined : props.onFillSlot) : props.onSelect}
          className="block w-full cursor-grab touch-manipulation px-2.5 py-1.5 text-left active:cursor-grabbing"
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className={isSlot ? "text-body-sm leading-tight font-medium text-ink-soft" : "font-mono text-body-sm font-medium"}>
              {isSlot && <span className="sr-only">Placeholder: </span>}
              {label}
              {schedule?.critical && !delay && (
                <span
                  className="ml-1.5 inline-block -translate-y-px rounded-sm bg-yellow px-1 align-middle font-mono text-label text-on-yellow uppercase"
                  title="No slack: taking this later delays graduation"
                >
                  ◆ no slack
                </span>
              )}
            </span>
            <span className="font-mono text-caption text-ink-soft tabular-nums">
              {credits}
              <span className="sr-only"> hours</span>
            </span>
          </span>
          {!isSlot && (
            <span className="mt-0.5 block truncate text-caption leading-snug text-ink-soft">
              {course?.title ?? "Not in this catalog"}
            </span>
          )}
          {isSlot && !props.readOnly && (
            <span className="mt-0.5 block text-label font-medium text-violet-text print:hidden">＋ pick a course</span>
          )}
          {delay && (
            <span className="mt-1 flex items-start gap-1 text-label leading-tight font-medium text-pink-text">
              <span aria-hidden>▲</span>
              <span>
                Delays graduation: {delay.chain.length - 1} course{delay.chain.length === 2 ? "" : "s"} after it need{" "}
                {delay.termsNeeded} more semester{delay.termsNeeded === 1 ? "" : "s"}
              </span>
            </span>
          )}
          {issue && (
            <span className="mt-1 flex items-start gap-1 text-label leading-tight font-medium text-pink-text">
              <span aria-hidden>✕</span>
              <span>Needs first: {issue.missing.join("; ")}</span>
            </span>
          )}
        </button>
      </div>

      {selected && !isSlot && (
        <div className="relative z-20 mt-1.5 rounded-chip border-2 border-ink bg-card p-2 text-caption shadow-[3px_3px_0_0_var(--shadow-ink)] print:hidden">
          {props.routeSummary && (
            <p className="mb-2 leading-snug">
              <span className="font-medium text-blue-text">Builds on:</span>{" "}
              {props.routeSummary.needs.length ? props.routeSummary.needs.join(", ") : "nothing in your plan"}
              <br />
              <span className="font-medium text-violet-text">Leads to:</span>{" "}
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
          <div className={`flex flex-wrap items-center gap-2 ${props.readOnly ? "hidden" : ""}`}>
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
