/**
 * The planner's answer line: "am I on track to graduate?" in one sentence,
 * derived from the evaluation (never hard-coded), plus one line of specifics.
 *
 * Tone: attention (alert) > planned > done.
 */
import type { DelayWarning, Evaluation, PrereqIssue, RuleResult } from "@plotted/engine";

export type AnswerTone = "attention" | "planned" | "done" | "empty";

export interface Answer {
  tone: AnswerTone;
  glyph: string;
  headline: string;
  detail: string;
  /** The open requirements, most specific first (for "show what's open"). */
  open: RuleResult[];
  /** Course item to highlight when the student asks to see the problem. */
  focusItemId?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Most specific rules that are unmet or partial; a "choose one" group counts once. */
export function openRules(ev: Evaluation): RuleResult[] {
  const out: RuleResult[] = [];
  const walk = (r: RuleResult) => {
    if (r.status !== "unmet" && r.status !== "partial") return;
    if (!r.children || r.type === "nOf") return void out.push(r);
    const before = out.length;
    r.children.forEach(walk);
    if (out.length === before) out.push(r);
  };
  ev.areas.forEach((a) => walk(a.result));
  return out;
}

function countStatus(ev: Evaluation, status: RuleResult["status"]): number {
  let n = 0;
  const walk = (r: RuleResult) => {
    if (!r.children) {
      if (r.status === status) n++;
      return;
    }
    r.children.forEach(walk);
  };
  ev.areas.forEach((a) => walk(a.result));
  return n;
}

export function answerFor({
  ev,
  delays,
  finish,
  itemCount,
}: {
  ev: Evaluation;
  delays: DelayWarning[];
  /** "Spring 2029" or "Year 4 · Spring". */
  finish: string | null;
  itemCount: number;
}): Answer {
  const open = openRules(ev);
  const issues: PrereqIssue[] = ev.prereqIssues;
  const manual = countStatus(ev, "manual");
  const confirm = manual ? ` · ${plural(manual, "rule")} to confirm with your advisor` : "";

  if (itemCount === 0) {
    return {
      tone: "empty",
      glyph: "○",
      headline: "Nothing planned yet",
      detail: "Add courses to a semester, or start from the catalog's suggested plan in the Plan menu.",
      open,
    };
  }
  if (delays.length) {
    const d = delays[0]!;
    const chain = d.chain.length > 3 ? `${d.chain[0]} → … → ${d.chain.at(-1)}` : d.chain.join(" → ");
    return {
      tone: "attention",
      glyph: "▲",
      headline: `Graduation slips past ${finish ?? "your last semester"}`,
      detail: `${chain} needs ${plural(d.termsNeeded, "more semester")} after ${d.code}; only ${d.termsLeft} remain${
        delays.length > 1 ? ` · ${plural(delays.length - 1, "more chain")} like this` : ""
      }.`,
      open,
      focusItemId: d.itemId,
    };
  }
  if (issues.length) {
    const i = issues[0]!;
    return {
      tone: "attention",
      glyph: "✕",
      headline:
        issues.length === 1
          ? `${i.code} comes before its prerequisites`
          : `${issues.length} courses come before their prerequisites`,
      detail: `${i.code} needs ${i.missing.join(" and ")} first${issues.length > 1 ? `, and ${plural(issues.length - 1, "more")}` : ""}.`,
      open,
      focusItemId: i.itemId,
    };
  }
  if (open.length) {
    return {
      tone: "attention",
      glyph: "◐",
      headline: `${plural(open.length, "requirement")} still open`,
      detail: `${open
        .slice(0, 2)
        .map((r) => r.label)
        .join(" · ")}${open.length > 2 ? ` · +${open.length - 2} more` : ""}${finish ? ` · last semester ${finish}` : ""}.`,
      open,
    };
  }
  const planned = countStatus(ev, "planned");
  if (planned) {
    return {
      tone: "planned",
      glyph: "◌",
      headline: `On track for ${finish ?? "graduation"}`,
      detail: `Every requirement is covered — ${plural(planned, "placeholder")} still need a real course${confirm}.`,
      open,
    };
  }
  return {
    tone: "done",
    glyph: "✓",
    headline: `On track for ${finish ?? "graduation"}`,
    detail: `Every requirement is met with real courses${confirm}.`,
    open,
  };
}
