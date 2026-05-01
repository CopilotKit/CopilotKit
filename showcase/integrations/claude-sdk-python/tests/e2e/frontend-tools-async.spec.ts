import { test, expect } from "@playwright/test";

test.describe("Frontend Tools (Async)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
  });

  test("page loads with chat surface", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Async metric suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Async metric/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="notes-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
