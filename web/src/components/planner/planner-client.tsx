"use client";

import dynamic from "next/dynamic";

/** The editable planner is server-rendered with the suggested plan (see planner.tsx). */
export { Planner as PlannerClient } from "./planner";

/**
 * Shared plans live in the URL fragment, which only the browser can read, so
 * the share view renders client-side only.
 */
export const SharedPlanClient = dynamic(() => import("./shared-plan").then((m) => m.SharedPlan), {
  ssr: false,
  loading: () => (
    <p className="wordmark p-8 text-3xl" role="status">
      Unfolding a shared plan…
    </p>
  ),
});
