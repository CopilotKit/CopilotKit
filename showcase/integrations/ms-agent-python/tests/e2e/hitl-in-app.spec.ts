import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the hitl-in-app demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("HITL In App — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("Refund approval canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page
      .getByRole("button", { name: /Refund approval/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
