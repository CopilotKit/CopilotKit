import { test, expect } from "@playwright/test";

test.describe("Tool Rendering + Reasoning Chain", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-reasoning-chain");
  });

  test("page renders chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Kyoto itinerary suggestion pill exercises the catalog message", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Kyoto itinerary" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
