import { test, expect } from "@playwright/test";

test.describe("HITL in app", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Refund approval/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
