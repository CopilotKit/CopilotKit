import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test("background container is visible", async ({ page }) => {
    await page.goto("/demos/frontend-tools");
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/frontend-tools");
    const pill = page.getByRole("button", { name: /Switch theme/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="background-container"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
