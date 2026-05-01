import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the declarative-gen-ui demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Declarative Gen UI — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
  });

  test("Show card canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Show card/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
