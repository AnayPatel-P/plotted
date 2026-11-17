import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const PLAN = "/plan/ut-austin/2026-28/ut-cs-bs";

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    count: v.nodes.length,
  }));
  expect(summary, `${label}: ${JSON.stringify(summary, null, 1)}`).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test("landing page with a school and major picked", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("radio", { name: /University of Texas/ }).click();
      await page.getByRole("radio", { name: /Computer Science/ }).click();
      await audit(page, "landing");
    });

    test("about page", async ({ page }) => {
      await page.goto("/about");
      await audit(page, "about");
    });

    test("planner with a course selected", async ({ page, isMobile }) => {
      await page.goto(`${PLAN}?start=suggested`);
      await page.getByRole("button", { name: /^C S 314 3 hours Data Structures/ }).click();
      await expect(page.getByText(/Builds on:/)).toBeVisible();
      if (!isMobile) await audit(page, "planner");
      else {
        await audit(page, "planner (phone)");
        await page.getByRole("button", { name: /^Requirements/ }).click();
        await audit(page, "requirements sheet");
      }
    });

    test("course picker dialog", async ({ page }) => {
      await page.goto(`${PLAN}?start=suggested`);
      await page.getByRole("button", { name: /^Placeholder: U\.S\. History/ }).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText(/courses?( ·|$)/).first()).toBeVisible();
      await audit(page, "course dialog");
    });
  });
}
