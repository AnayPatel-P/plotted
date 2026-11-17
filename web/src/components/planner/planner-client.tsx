"use client";

import dynamic from "next/dynamic";

/**
 * The planner keeps the student's plan in browser storage, so it renders only
 * in the browser: it can read the saved plan on its first render without a
 * server/client mismatch.
 */
export const PlannerClient = dynamic(() => import("./planner").then((m) => m.Planner), {
  ssr: false,
  loading: () => (
    <p className="riso-title p-8 text-3xl font-extrabold" role="status">
      Inking your plan…
    </p>
  ),
});

export const SharedPlanClient = dynamic(() => import("./shared-plan").then((m) => m.SharedPlan), {
  ssr: false,
  loading: () => (
    <p className="riso-title p-8 text-3xl font-extrabold" role="status">
      Unfolding a shared plan…
    </p>
  ),
});
