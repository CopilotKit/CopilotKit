import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the frontend-tools demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Frontend Tools — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools");
  });

  test("Switch theme canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Switch theme/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible({ timeout: 60_000 });
  });
});
