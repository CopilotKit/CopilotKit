import { test, expect } from "@playwright/test";

test.describe("Human in the Loop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Sourcing route/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="select-steps"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
