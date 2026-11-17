/**
 * Row-level security on `plans`, against the LOCAL Supabase stack.
 * Run with `npm run test:rls` (needs `npx supabase start`). Skipped otherwise.
 *
 * Creates two throwaway users with random credentials via the local admin API,
 * then checks neither can see or change the other's plans and anonymous
 * visitors see nothing.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const adminKey = process.env.SUPABASE_SECRET_KEY;
const local = !!url && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);

const plan = { school: "ut-austin", catalog_year: "2026-28", program_id: "ut-cs-bs", terms: [], extra_courses: [] };

describe.skipIf(!local || !anonKey || !adminKey)("plans row-level security (local stack)", () => {
  const admin = createClient(url!, adminKey!, { auth: { persistSession: false } });
  const users: { id: string; client: SupabaseClient }[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const email = `rls-${randomUUID()}@example.test`;
      const password = randomUUID();
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      const client = createClient(url!, anonKey!, { auth: { persistSession: false } });
      const signIn = await client.auth.signInWithPassword({ email, password });
      if (signIn.error) throw signIn.error;
      users.push({ id: data.user.id, client });
    }
  });

  afterAll(async () => {
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  });

  it("each user can create and read only their own plans", async () => {
    const [a, b] = users as [(typeof users)[0], (typeof users)[0]];
    const ins = await a.client.from("plans").insert({ ...plan, name: "A's plan" }).select("id, user_id").single();
    expect(ins.error).toBeNull();
    expect(ins.data!.user_id).toBe(a.id);

    const seenByA = await a.client.from("plans").select("id");
    expect(seenByA.data!.map((r) => r.id)).toContain(ins.data!.id);
    const seenByB = await b.client.from("plans").select("id");
    expect(seenByB.data).toEqual([]);
  });

  it("a user can't update, delete or steal another user's plan", async () => {
    const [a, b] = users as [(typeof users)[0], (typeof users)[0]];
    const { data: row } = await a.client.from("plans").insert({ ...plan, name: "Mine" }).select("id").single();

    const upd = await b.client.from("plans").update({ name: "Hacked" }).eq("id", row!.id).select("id");
    expect(upd.data).toEqual([]); // filtered out by RLS: nothing updated
    const del = await b.client.from("plans").delete().eq("id", row!.id).select("id");
    expect(del.data).toEqual([]);
    const after = await a.client.from("plans").select("name").eq("id", row!.id).single();
    expect(after.data!.name).toBe("Mine");

    // Inserting a row owned by someone else is rejected.
    const forged = await b.client.from("plans").insert({ ...plan, user_id: a.id, name: "Forged" });
    expect(forged.error).not.toBeNull();
    // And an owner can't hand a plan to someone else.
    const move = await a.client.from("plans").update({ user_id: b.id }).eq("id", row!.id);
    expect(move.error).not.toBeNull();
  });

  it("anonymous visitors can't read or write plans", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const read = await anon.from("plans").select("id");
    expect(read.data ?? []).toEqual([]);
    const write = await anon.from("plans").insert({ ...plan, name: "anon" });
    expect(write.error).not.toBeNull();
  });

  it("rejects malformed rows", async () => {
    const [a] = users as [(typeof users)[0]];
    const bad = await a.client.from("plans").insert({ ...plan, school: "Not Valid!", name: "x" });
    expect(bad.error).not.toBeNull();
  });

  it("events: anyone can record a well-formed event, nobody can read them", async () => {
    const anon = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const ev = { name: "plan_opened", anon_id: randomUUID(), school: "ut-austin", program_id: "ut-cs-bs" };
    expect((await anon.from("events").insert(ev)).error).toBeNull();
    const [a] = users as [(typeof users)[0]];
    expect((await a.client.from("events").insert({ ...ev, name: "signed_in" })).error).toBeNull();

    const readAnon = await anon.from("events").select("id");
    expect(readAnon.error ?? readAnon.data?.length).toBeTruthy(); // error (no privilege), never rows
    expect(readAnon.data ?? []).toEqual([]);
    const readUser = await a.client.from("events").select("id");
    expect(readUser.data ?? []).toEqual([]);

    expect((await anon.from("events").insert({ ...ev, name: "drop_table" })).error).not.toBeNull();
    expect((await anon.from("events").insert({ ...ev, school: "<script>" })).error).not.toBeNull();
    // Columns outside the allowed set (e.g. a forged timestamp) are rejected.
    expect((await anon.from("events").insert({ ...ev, created_at: "2000-01-01" })).error).not.toBeNull();
  });

  it("v2: start_term accepts real terms only", async () => {
    const [a] = users as [(typeof users)[0]];
    const ok = await a.client.from("plans").insert({ ...plan, name: "v2", start_term: "Fall 2025" }).select("start_term").single();
    expect(ok.data?.start_term).toBe("Fall 2025");
    const bad = await a.client.from("plans").insert({ ...plan, name: "v2", start_term: "Autumn 25" });
    expect(bad.error).not.toBeNull();
    const none = await a.client.from("plans").insert({ ...plan, name: "v1-style" });
    expect(none.error).toBeNull();
  });
});
