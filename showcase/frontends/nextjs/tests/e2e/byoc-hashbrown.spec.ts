import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// byoc-hashbrown shows the declarative-hashbrown page through its own runtime
// and agent id (`byoc-hashbrown-demo`). declarative-hashbrown.spec.ts covers
// the page's features; these tests check that this route serves the page and
// that its agent answers.
describeDemo("byoc-hashbrown", "BYOC: Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("byoc-hashbrown"));
  });

  test("header renders", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Declarative UI: Hashbrown" }),
    ).toBeVisible();
  });

  test("chat composer is visible", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("sales-dashboard suggestion triggers a hashbrown render", async ({
    page,
  }) => {
    await page.getByText("Sales dashboard").first().click();
    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 60000 });
  });
});
