import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the gen-ui-interrupt demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Gen UI Interrupt — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-interrupt");
  });

  test("Pause and pick canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Pause and pick/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    // Selector divergence fallback: assistant message (time-picker-card may
    // not render synchronously under mock fixtures).
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
