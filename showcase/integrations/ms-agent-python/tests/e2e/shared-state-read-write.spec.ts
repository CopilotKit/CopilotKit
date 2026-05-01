import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the shared-state-read-write demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Shared State (Read + Write) — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-read-write");
  });

  test("Weekend plan canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Weekend plan/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
