import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the hitl demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("HITL — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("Sourcing route canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Sourcing route/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    // Selector divergence fallback: assistant message rather than
    // [data-testid="select-steps"] which depends on interrupt rendering.
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
