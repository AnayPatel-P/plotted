import { expect, type Page, test } from "@playwright/test";

const visibleChip = (page: Page, name: RegExp) => page.getByRole("button", { name }).locator("visible=true").first();

test("pick a major, fill a slot, and the plan survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: /University of Texas/ }).click();
  await page.getByRole("radio", { name: /Computer Science/ }).click();
  await page.getByRole("link", { name: /Start from the suggested plan/ }).click();
  await expect(page).toHaveURL(/\/plan\/ut-austin\/2026-28\/ut-cs-bs$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Computer Science");

  // Fill an Upper-division C S placeholder with C S 373 (it also carries the 010 flag).
  if (await page.getByRole("button", { name: "Year 2", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Year 2", exact: true }).click(); // phone: one year at a time
  }
  await visibleChip(page, /^Placeholder: Upper-division C S/).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("searchbox").fill("373");
  await dialog.getByRole("button", { name: /^C S 373 3 hrs Software Engineering/ }).click();
  await expect(dialog).toBeHidden();
  await expect(visibleChip(page, /^C S 373 /)).toBeVisible();

  // Removing happens at once and offers Undo instead of a confirm dialog.
  await visibleChip(page, /^C S 373 /).click();
  await page.getByRole("button", { name: "Remove", exact: true }).locator("visible=true").click();
  await expect(page.getByRole("status").filter({ hasText: "Removed C S 373." })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(visibleChip(page, /^C S 373 /)).toBeVisible();

  // Reload right away: the pending save is flushed when the page is hidden.
  await page.reload();
  if (await page.getByRole("button", { name: "Year 2", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Year 2", exact: true }).click();
  }
  await expect(visibleChip(page, /^C S 373 /)).toBeVisible();
});

test("a prerequisite problem shows up and clears, using only the keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow is checked on desktop");
  await page.goto("/plan/ut-austin/2026-28/ut-cs-bs?start=suggested");
  await page.locator("[data-ready]").waitFor();
  const cs314 = page.getByRole("button", { name: /^C S 314 / });
  await cs314.focus();
  await page.keyboard.press("Enter");
  const move = page.getByRole("combobox", { name: /Move C S 314 to another semester/ });
  await move.focus();
  await move.selectOption({ label: "Move to Year 1 · Fall" });
  await expect(page.getByRole("button", { name: /^C S 314 .*Needs first/ })).toBeVisible();

  // The course stays selected after moving, so its menu is still open.
  await page.getByRole("combobox", { name: /Move C S 314 to another semester/ }).selectOption({ label: "Move to Year 1 · Spring" });
  await expect(page.getByRole("button", { name: /^C S 314 .*Needs first/ })).toHaveCount(0);
});

test("start empty, then share a read-only link that opens elsewhere", async ({ page, context, browserName }) => {
  await page.goto("/plan/tamu/2026-27/tamu-daen-bs?start=empty");
  await page.locator("[data-ready]").waitFor();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Data Engineering");
  // A cleared plan keeps the degree's shape: requirement placeholders, no courses yet.
  await expect(page.getByRole("button", { name: /^Placeholder: MATH 151/ }).locator("visible=true").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^MATH 151 / })).toHaveCount(0);

  await page.goto("/plan/tamu/2026-27/tamu-daen-bs?start=suggested");

  await page.locator("[data-ready]").waitFor();
  await page.evaluate(() => {
    (window as unknown as { __shared: string }).__shared = "";
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (u: string) => ((window as unknown as { __shared: string }).__shared = u) },
      configurable: true,
    });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });
  await page.locator("header details summary").click();
  await page.getByRole("button", { name: "Share a read-only link" }).click();
  const url = await page.waitForFunction(() => (window as unknown as { __shared: string }).__shared).then((h) => h.jsonValue());
  expect(url).toMatch(/\/share\/tamu\/2026-27\/tamu-daen-bs#p=1\./);

  // A different visitor: fresh browser storage.
  const other = await context.browser()!.newContext();
  const viewer = await other.newPage();
  await viewer.goto(String(url));
  await expect(viewer.getByText(/Shared plan — read-only/)).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Copy into my plan" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: /＋ Course/ })).toHaveCount(0);
  expect(await viewer.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("plotted:plan:")))).toEqual([]);
  await other.close();
  void browserName;
});

test("pages load without console errors (no hydration mismatches)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  for (const path of [
    "/",
    "/about",
    "/plan/ut-austin/2026-28/ut-cs-bs?start=suggested",
    "/plan/ut-austin/2026-28/ut-math-bs",
    "/plan/tamu/2026-27/tamu-daen-bs?start=empty",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(errors).toEqual([]);
});

test("v2: set where you started and add credit before college", async ({ page }) => {
  await page.goto("/plan/ut-austin/2026-28/ut-cs-bs?start=suggested");
  await page.locator("[data-ready]").waitFor();
  await page.getByRole("combobox", { name: /Started/ }).selectOption("Fall 2025");
  // Year 1 is in the past for any date after summer 2026, so it's marked completed.
  await expect(page.locator('section[data-status="completed"]').first()).toBeVisible();
  await expect(page.getByRole("region", { name: /^Fall 2025 \(completed\)/ })).toBeVisible();

  await page.getByRole("button", { name: "＋ Credit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("searchbox").fill("408C");
  await dialog.getByRole("button", { name: /^M 408C .*moves to credit/ }).click();
  const credit = page.locator('section[data-status="credit"]');
  await expect(credit.getByRole("button", { name: /^M 408C / })).toBeVisible();

  await page.reload();
  await expect(page.locator('section[data-status="credit"]').getByRole("button", { name: /^M 408C / })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Started/ })).toHaveValue("Fall 2025");
});
