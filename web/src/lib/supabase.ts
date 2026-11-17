"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * Browser Supabase client, or null when the project isn't configured (the app
 * then works fully signed-out, saving to browser storage only).
 *
 * Sign-in uses the PKCE flow: Google redirects back to the page the student
 * was on with `?code=…`, and the client exchanges it on load.
 */
export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  client =
    url && key
      ? createClient(url, key, {
          auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        })
      : null;
  return client;
}
