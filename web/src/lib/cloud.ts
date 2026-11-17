"use client";

/**
 * Account-synced plans (Supabase `plans` table, private per user via RLS).
 */
import { Course, Term } from "@plotted/engine";
import type { User } from "@supabase/supabase-js";
import { useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import type { PlanState } from "./plan-state";
import { supabase } from "./supabase";

export interface ProgramRef {
  school: string;
  year: string;
  programId: string;
}

const Row = z.object({
  id: z.string(),
  name: z.string(),
  terms: z.array(Term),
  extra_courses: z.array(Course),
  updated_at: z.string(),
});
export type CloudPlan = { id: string; name: string; state: PlanState; updatedAt: string };

const toPlan = (r: z.infer<typeof Row>): CloudPlan => ({
  id: r.id,
  name: r.name,
  state: { terms: r.terms, extraCourses: r.extra_courses },
  updatedAt: r.updated_at,
});

const COLUMNS = "id, name, terms, extra_courses, updated_at";

/** Current user (null when signed out or when accounts aren't configured). */
const noopSubscribe = () => () => {};

export function useUser(): { user: User | null; ready: boolean; enabled: boolean } {
  // false during server render and hydration, true after: account UI appears only once hydrated,
  // so server and browser render the same markup.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const sb = hydrated ? supabase() : null;
  const [state, setState] = useState<{ user: User | null; ready: boolean }>({ user: null, ready: !sb });
  useEffect(() => {
    if (!sb) return;
    let alive = true;
    sb.auth.getSession().then(({ data }) => alive && setState({ user: data.session?.user ?? null, ready: true }));
    const { data } = sb.auth.onAuthStateChange((_e, session) => setState({ user: session?.user ?? null, ready: true }));
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [sb]);
  return { ...state, enabled: !!sb };
}

/** Starts Google sign-in (the page navigates away). Returns an error message if it can't start. */
export async function signInWithGoogle(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return "Accounts aren't set up on this site.";
  const back = new URL(window.location.href);
  back.search = "";
  const { data, error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: back.toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) return error?.message ?? "Couldn't start sign-in.";
  // Check the provider is actually enabled before leaving the page.
  const probe = await fetch(data.url, { redirect: "manual" }).catch(() => null);
  if (probe && probe.status >= 400) {
    const body = (await probe.json().catch(() => null)) as { msg?: string } | null;
    return body?.msg ?? "Google sign-in isn't available right now.";
  }
  window.location.assign(data.url);
  return null;
}

export async function signOut() {
  await supabase()?.auth.signOut();
}

export async function listPlans(ref: ProgramRef): Promise<CloudPlan[]> {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("plans")
    .select(COLUMNS)
    .eq("school", ref.school)
    .eq("catalog_year", ref.year)
    .eq("program_id", ref.programId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return z.array(Row).parse(data).map(toPlan);
}

export async function createPlan(ref: ProgramRef, name: string, state: PlanState): Promise<CloudPlan> {
  const sb = supabase()!;
  const { data, error } = await sb
    .from("plans")
    .insert({
      school: ref.school,
      catalog_year: ref.year,
      program_id: ref.programId,
      name,
      terms: state.terms,
      extra_courses: state.extraCourses,
    })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return toPlan(Row.parse(data));
}

export async function updatePlan(id: string, patch: { state?: PlanState; name?: string }): Promise<string> {
  const sb = supabase()!;
  const { data, error } = await sb
    .from("plans")
    .update({
      ...(patch.state ? { terms: patch.state.terms, extra_courses: patch.state.extraCourses } : {}),
      ...(patch.name ? { name: patch.name } : {}),
    })
    .eq("id", id)
    .select("updated_at")
    .single();
  if (error) throw error;
  return (data as { updated_at: string }).updated_at;
}

export async function deletePlan(id: string) {
  const { error } = await supabase()!.from("plans").delete().eq("id", id);
  if (error) throw error;
}
