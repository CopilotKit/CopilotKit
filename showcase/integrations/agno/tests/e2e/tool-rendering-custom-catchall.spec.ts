import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Custom Catch-all)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
  });

  // Canonical e2e suggestion — single "Custom catchall" pill from
  // _canonical-catalog.json. Clicking it dispatches the canonical message
  // and renders the branded catch-all card.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Custom catchall" })
      .first()
      .click();

    const card = page.locator('[data-testid="custom-catchall-card"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });
  });
});
