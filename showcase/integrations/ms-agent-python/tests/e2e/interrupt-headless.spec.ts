import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the interrupt-headless demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Interrupt Headless — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/interrupt-headless");
  });

  test("Headless interrupt canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page
      .getByRole("button", { name: /Headless interrupt/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
