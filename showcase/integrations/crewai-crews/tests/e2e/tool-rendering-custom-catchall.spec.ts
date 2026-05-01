import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Custom Catch-all)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
  });

  test("page renders chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Custom catchall suggestion pill renders the custom catchall card", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Custom catchall" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="custom-catchall-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
