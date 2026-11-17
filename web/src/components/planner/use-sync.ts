"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CloudPlan,
  createPlan,
  deletePlan,
  listPlans,
  type ProgramRef,
  signOut as authSignOut,
  updatePlan,
  useUser,
} from "@/lib/cloud";
import { track } from "@/lib/analytics";
import { type Action, clearAllSaved, loadSaved, type PlanState } from "@/lib/plan-state";

export type SyncStatus = "off" | "signed-out" | "connecting" | "saving" | "synced" | "error";

const same = (a: PlanState, b: PlanState) =>
  JSON.stringify(a.terms) === JSON.stringify(b.terms) && JSON.stringify(a.extraCourses) === JSON.stringify(b.extraCourses);

/**
 * Keeps the planner's state in sync with the signed-in user's account plans.
 * Browser storage stays the source of truth while signed out and as a backup
 * while signed in.
 */
export function usePlanSync({
  ref,
  storageKey,
  state,
  dispatch,
  suggested,
  disabled = false,
}: {
  ref: ProgramRef;
  storageKey: string;
  state: PlanState;
  dispatch: (a: Action) => void;
  suggested: PlanState;
  /** Read-only views (shared plans) never sync. */
  disabled?: boolean;
}) {
  const auth = useUser();
  const enabled = auth.enabled && !disabled;
  const ready = auth.ready;
  const user = enabled ? auth.user : null;
  const [plans, setPlans] = useState<CloudPlan[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const linkedUser = useRef<string | null>(null);
  const skipNextSave = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  // Link this browser's plan with the account when a user is present.
  useEffect(() => {
    if (!ready || !enabled) return;
    if (!user) {
      linkedUser.current = null;
      return;
    }
    if (linkedUser.current === user.id) return;
    linkedUser.current = user.id;
    let alive = true;
    (async () => {
      setStatus("connecting");
      try {
        const list = await listPlans(ref);
        const local = loadSaved(storageKey);
        const current = stateRef.current;
        const linked = local?.remoteId ? list.find((p) => p.id === local.remoteId) : undefined;
        let active: CloudPlan;
        let all = list;
        if (linked) {
          if (local && local.savedAt > linked.updatedAt && !same(current, linked.state)) {
            await updatePlan(linked.id, { state: current });
            active = { ...linked, state: current };
          } else {
            active = linked;
            skipNextSave.current = true;
            dispatch({ type: "load", state: linked.state });
          }
        } else if (list.length && (!local || same(current, suggested))) {
          active = list[0]!;
          skipNextSave.current = true;
          dispatch({ type: "load", state: active.state });
        } else if (list.length) {
          active = await createPlan(ref, "From this browser", current);
          all = [active, ...list];
          setNotice("You already had a plan in your account, so this browser's plan was saved as a second plan. Switch between them in the Plan menu.");
        } else {
          active = await createPlan(ref, "My plan", current);
          all = [active];
        }
        if (!alive) return;
        track("signed_in", { school: ref.school, programId: ref.programId });
        setPlans(all);
        setActiveId(active.id);
        setStatus("synced");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready, enabled, user, ref, storageKey, dispatch, suggested]);

  // Save changes to the account (debounced).
  useEffect(() => {
    if (!user || !activeId || status === "connecting") return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setStatus("saving");
      try {
        const updatedAt = await updatePlan(activeId, { state });
        setPlans((ps) => ps.map((p) => (p.id === activeId ? { ...p, state, updatedAt } : p)));
        setStatus("synced");
      } catch {
        setStatus("error");
      }
    }, 800);
    return () => clearTimeout(t);
    // Only plan edits should trigger a save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const switchTo = useCallback(
    (id: string) => {
      const p = plans.find((x) => x.id === id);
      if (!p) return;
      skipNextSave.current = true;
      setActiveId(id);
      dispatch({ type: "load", state: p.state });
    },
    [plans, dispatch],
  );

  const newPlan = useCallback(
    async (from: "copy" | "suggested") => {
      const name = window.prompt("Name for the new plan:", from === "copy" ? "Copy of my plan" : "Fresh plan");
      if (!name) return;
      try {
        const p = await createPlan(ref, name.slice(0, 80), from === "copy" ? stateRef.current : suggested);
        setPlans((ps) => [p, ...ps]);
        skipNextSave.current = true;
        setActiveId(p.id);
        dispatch({ type: "load", state: p.state });
      } catch {
        setStatus("error");
      }
    },
    [ref, suggested, dispatch],
  );

  const rename = useCallback(async () => {
    const current = plans.find((p) => p.id === activeId);
    if (!current) return;
    const name = window.prompt("Rename this plan:", current.name);
    if (!name) return;
    try {
      await updatePlan(current.id, { name: name.slice(0, 80) });
      setPlans((ps) => ps.map((p) => (p.id === current.id ? { ...p, name: name.slice(0, 80) } : p)));
    } catch {
      setStatus("error");
    }
  }, [plans, activeId]);

  const remove = useCallback(async () => {
    const current = plans.find((p) => p.id === activeId);
    if (!current || plans.length < 2) return;
    if (!window.confirm(`Delete “${current.name}” from your account? This can't be undone.`)) return;
    try {
      await deletePlan(current.id);
      const rest = plans.filter((p) => p.id !== current.id);
      setPlans(rest);
      skipNextSave.current = true;
      setActiveId(rest[0]!.id);
      dispatch({ type: "load", state: rest[0]!.state });
    } catch {
      setStatus("error");
    }
  }, [plans, activeId, dispatch]);

  const signOut = useCallback(async () => {
    if (!window.confirm("Sign out? Your plans stay in your account and are removed from this browser.")) return;
    await authSignOut();
    clearAllSaved();
    setActiveId(null);
    skipNextSave.current = true;
    dispatch({ type: "load", state: suggested });
  }, [dispatch, suggested]);

  return {
    enabled,
    user,
    plans: user ? plans : [],
    activeId,
    status: (!enabled ? "off" : !ready ? "connecting" : !user ? "signed-out" : status) as SyncStatus,
    notice,
    dismissNotice: () => setNotice(null),
    switchTo,
    newPlan,
    rename,
    remove,
    signOut,
  };
}
