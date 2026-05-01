import { test, expect } from "@playwright/test";

test.describe("Reasoning (Default Render)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Default reasoning suggestion pill renders the reasoning message", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Default reasoning" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-reasoning-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
