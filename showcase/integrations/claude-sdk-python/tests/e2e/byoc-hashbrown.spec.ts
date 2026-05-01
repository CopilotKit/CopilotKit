import { test, expect } from "@playwright/test";

test.describe("BYOC hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("header renders", async ({ page }) => {
    await expect(page.getByText("BYOC: Hashbrown")).toBeVisible();
  });

  test("chat composer is visible", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Sales overview suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Sales overview/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
