import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the prebuilt-popup demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
// The popup is `defaultOpen={true}` so the suggestion pill renders without
// any user gesture.
test.describe("Prebuilt Popup — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("Popup hello canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Popup hello/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
