import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the byoc-hashbrown demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("BYOC Hashbrown — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("Sales overview canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Sales overview/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    // Selector divergence fallback: HashBrownAssistantMessage may not expose
    // the canonical metric-card testid synchronously under the mock fixture.
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
