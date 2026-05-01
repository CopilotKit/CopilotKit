import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the open-gen-ui demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Open Gen UI — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui");
  });

  test("Open block canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Open block/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
