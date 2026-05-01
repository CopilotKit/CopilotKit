import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools");
  });

  test("page loads with chat surface", async ({ page }) => {
    await expect(page.getByTestId("background-container")).toBeVisible();
  });

  test("chat input is reachable", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Switch theme suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Switch theme/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="background-container"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
