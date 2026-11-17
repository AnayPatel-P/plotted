"use client";

/**
 * First-party, anonymous product events (see supabase/migrations/*_events.sql).
 * Stores: event name, a random per-browser id, school/program, and an optional
 * duration. Never: account ids, emails, IPs, or plan contents. Respects Do Not
 * Track and Global Privacy Control. Fire-and-forget; failures are ignored.
 */
import { supabase } from "./supabase";

export type EventName =
  | "plan_opened"
  | "first_plan"
  | "plan_edited"
  | "share_created"
  | "shared_opened"
  | "pdf_printed"
  | "signed_in";

const ID_KEY = "plotted:anon-id";
const FIRST_SEEN_KEY = "plotted:first-seen";
const FIRST_PLAN_KEY = "plotted:first-plan";

function optedOut(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

function anonId(): string | null {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function track(name: EventName, props: { school?: string; programId?: string; valueMs?: number } = {}) {
  try {
    if (typeof window === "undefined" || optedOut()) return;
    const sb = supabase();
    const id = anonId();
    if (!sb || !id) return;
    void sb
      .from("events")
      .insert({
        name,
        anon_id: id,
        school: props.school ?? null,
        program_id: props.programId ?? null,
        value_ms: props.valueMs === undefined ? null : Math.max(0, Math.min(2_000_000_000, Math.round(props.valueMs))),
      })
      .then(() => undefined, () => undefined);
  } catch {
    /* analytics must never break the app */
  }
}

/** Remember when this browser first visited (for "time to first plan"). */
export function markFirstSeen() {
  try {
    if (!localStorage.getItem(FIRST_SEEN_KEY)) localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Records plan_opened, plus first_plan with the time since first visit (once per browser). */
export function trackPlanOpened(school: string, programId: string) {
  track("plan_opened", { school, programId });
  try {
    if (localStorage.getItem(FIRST_PLAN_KEY)) return;
    markFirstSeen();
    const since = Date.now() - Number(localStorage.getItem(FIRST_SEEN_KEY));
    localStorage.setItem(FIRST_PLAN_KEY, "1");
    track("first_plan", { school, programId, valueMs: since });
  } catch {
    /* ignore */
  }
}
