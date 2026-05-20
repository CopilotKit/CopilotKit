import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Custom Catch-all)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
  });

  test("clicking a suggestion renders the branded catch-all card", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Weather in SF" })
      .first()
      .click();

    const card = page.locator('[data-testid="custom-catchall-card"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });

    await expect(
      card.locator('[data-testid="custom-catchall-tool-name"]'),
    ).toBeVisible();
  });
});
