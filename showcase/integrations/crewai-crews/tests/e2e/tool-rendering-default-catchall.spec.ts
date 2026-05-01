import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Default Catch-all)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("page renders chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Default catchall suggestion pill renders the default catchall card", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Default catchall" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="custom-catchall-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
