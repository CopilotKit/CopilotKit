import { test, expect } from "@playwright/test";

test.describe("A2UI Fixed-Schema", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
  });

  test("demo-root renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="a2ui-fixed-schema-root"]'),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Block calendar suggestion pill exercises the catalog message", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Block calendar" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
