import { expect, type Page, test } from "@playwright/test";

/** Captures analytics inserts instead of sending them anywhere. */
async function captureEvents(page: Page) {
  const events: Record<string, unknown>[] = [];
  await page.route("**/rest/v1/events**", async (route) => {
    const body = route.request().postDataJSON();
    events.push(...(Array.isArray(body) ? body : [body]));
    await route.fulfill({ status: 201, body: "" });
  });
  return events;
}

test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.CI, "analytics needs Supabase config");

test("records anonymous events with only the allowed fields", async ({ page }) => {
  const events = await captureEvents(page);
  await page.goto("/");
  await page.getByRole("radio", { name: /Texas A&M/ }).click();
  await page.getByRole("radio", { name: /Data Engineering/ }).click();
  await page.getByRole("link", { name: /Start from the suggested plan/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Data Engineering");
  await expect.poll(() => events.map((e) => e.name)).toEqual(expect.arrayContaining(["plan_opened", "first_plan"]));

  for (const e of events) {
    expect(Object.keys(e).sort()).toEqual(["anon_id", "name", "program_id", "school", "value_ms"]);
    expect(e.anon_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.school).toBe("tamu");
  }
  const first = events.find((e) => e.name === "first_plan")!;
  expect(typeof first.value_ms).toBe("number");
  // The same random id is reused, and nothing identifying is sent.
  expect(new Set(events.map((e) => e.anon_id)).size).toBe(1);
  expect(JSON.stringify(events)).not.toMatch(/@|MATH 151|token/);
});

test("sends nothing when the browser asks not to be tracked", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
  const events = await captureEvents(page);
  await page.goto("/plan/ut-austin/2026-28/ut-cs-bs?start=suggested");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Computer Science");
  await page.waitForTimeout(1000);
  expect(events).toEqual([]);
});
