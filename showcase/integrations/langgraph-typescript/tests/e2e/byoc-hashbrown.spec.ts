import { test, expect } from "@playwright/test";

test.describe("BYOC Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Sales overview/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
