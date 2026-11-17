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
  /** Line color and lane position (the strip map on phones uses the lane index). */
  color: string;
  laneIndex: number;
  onSelect: () => void;
  onFillSlot: () => void;
  onMove: (toTermId: string) => void;
  onRemove: () => void;
  routeSummary?: { needs: string[]; unlocks: string[]; slack: number };
  readOnly?: boolean;
}

/** A stop on its requirement line: station marker, code, title. Placeholders are open rings. */
export function PlanItemChip(props: Props) {
  const { item, course, issue, schedule, delay, route, highlighted, selected, termId } = props;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, data: { termId }, disabled: !!props.readOnly });

  const isSlot = item.kind === "slot";
  const credits = item.kind === "slot" ? item.credits : (course?.credits ?? "?");
  const problem = !!issue || !!delay;

  return (
    <li ref={setNodeRef} data-item-id={item.id} style={{ ["--c" as string]: props.color, ["--lane-i" as string]: props.laneIndex }}>
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-pressed={isSlot ? undefined : selected}
        onClick={isSlot ? (props.readOnly ? undefined : props.onFillSlot) : props.onSelect}
        className="stop"
        data-slot={isSlot ? "" : undefined}
        data-issue={problem ? "" : undefined}
        data-hl={highlighted ? "" : undefined}
        data-dim={route === "dim" ? "" : undefined}
        data-lifted={isDragging ? "" : undefined}
      >
        <span className="stop-dot" data-dot={item.id} aria-hidden />
        <span className="stop-text">
          <span className="flex items-baseline justify-between gap-1.5">
            <span className={isSlot ? "slot-label text-body-sm leading-tight" : "font-mono text-body-sm leading-tight font-bold whitespace-nowrap"}>
              {isSlot && <span className="sr-only">Placeholder: </span>}
              {item.kind === "slot" ? item.label : item.code}
            </span>
            <span className="font-mono text-label text-ink-soft tabular-nums">
              {credits}
              <span className="sr-only"> hours</span>
            </span>
          </span>
          {!isSlot && (
            <span className="mt-0.5 line-clamp-2 block text-caption leading-snug text-ink-soft">{course?.title ?? "Not in this catalog"}</span>
          )}
          {isSlot && !props.readOnly && (
            <span className="mt-0.5 block text-label font-semibold tracking-normal text-ink print:hidden">＋ pick a course</span>
          )}
          {schedule?.critical && !delay && (
            <span
              className="mt-1 inline-block rounded-sm bg-ink px-1 font-mono text-label leading-normal text-paper uppercase"
              title="No slack: taking this later delays graduation"
            >
              ◆ no slack
            </span>
          )}
          {delay && (
            <span className="mt-1 flex items-start gap-1 text-label leading-tight font-semibold tracking-normal text-alert-text">
              <span aria-hidden>▲</span>
              <span>
                Delays graduation: {delay.chain.length - 1} course{delay.chain.length === 2 ? "" : "s"} after it need{" "}
                {delay.termsNeeded} more semester{delay.termsNeeded === 1 ? "" : "s"}
              </span>
            </span>
          )}
          {issue && (
            <span className="mt-1 flex items-start gap-1 text-label leading-tight font-semibold tracking-normal text-alert-text">
              <span aria-hidden>✕</span>
              <span>Needs first: {issue.missing.join("; ")}</span>
            </span>
          )}
        </span>
      </button>

    </li>
  );
}

/** The selected course's route and actions, floating over the diagram. */
export function StopCard(props: Pick<Props, "item" | "terms" | "termId" | "onMove" | "onRemove" | "routeSummary" | "readOnly">) {
  const { item, terms, termId } = props;
  return (
        <div role="region" aria-label={`Route for ${item.kind === "course" ? item.code : ""}`} className="menu fixed right-4 bottom-20 z-40 w-[min(20rem,calc(100vw-2rem))] p-3 text-body-sm sm:bottom-6 print:hidden">
          {item.kind === "course" && <p className="mb-1 font-mono text-title-sm font-bold">{item.code}</p>}
          {props.routeSummary && (
            <p className="mb-3 leading-snug">
              <span className="font-bold">Builds on:</span>{" "}
              {props.routeSummary.needs.length ? props.routeSummary.needs.join(", ") : "nothing in your plan"}
              <br />
              <span className="font-bold">Leads to:</span>{" "}
              {props.routeSummary.unlocks.length
                ? props.routeSummary.unlocks.slice(0, 8).join(", ") +
                  (props.routeSummary.unlocks.length > 8 ? ` +${props.routeSummary.unlocks.length - 8} more` : "")
                : "nothing in your plan"}
              <br />
              <span className="font-bold">Timing:</span>{" "}
              {props.routeSummary.slack > 0
                ? `could move ${props.routeSummary.slack} semester${props.routeSummary.slack === 1 ? "" : "s"} later without delaying graduation`
                : props.routeSummary.slack === 0
                  ? props.routeSummary.unlocks.length
                    ? "no slack — taking it later delays graduation"
                    : "in your final stretch"
                  : "already too late for the courses after it"}
            </p>
          )}
          <div className={`flex flex-col gap-1.5 ${props.readOnly ? "hidden" : ""}`}>
            <label>
              <span className="sr-only">Move {item.kind === "course" ? item.code : ""} to</span>
              <select
                aria-label={`Move ${item.kind === "course" ? item.code : ""} to another semester`}
                className="w-full rounded-chip border-[1.5px] border-ink bg-paper px-1.5 py-1 font-medium"
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
            <button type="button" onClick={props.onRemove} className="btn justify-center py-1 text-caption">
              Remove
            </button>
          </div>
        </div>
  );
}
