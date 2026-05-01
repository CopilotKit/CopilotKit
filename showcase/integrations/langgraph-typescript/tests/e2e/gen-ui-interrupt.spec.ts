import { test, expect } from "@playwright/test";

test.describe("Gen UI Interrupt", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-interrupt");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Pause and pick/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="time-picker-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
