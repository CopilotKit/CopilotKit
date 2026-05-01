import { test, expect } from "@playwright/test";

test.describe("BYOC: Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("demo-root renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="byoc-hashbrown-root"]'),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Sales overview suggestion pill renders a metric card", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Sales overview" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
