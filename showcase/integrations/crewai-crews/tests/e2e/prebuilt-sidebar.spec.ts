import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("main content heading renders", async ({ page }) => {
    await expect(
      page.getByText("Sidebar demo — click the launcher"),
    ).toBeVisible();
  });

  test("sidebar is open by default and shows chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Sidebar hello suggestion pill keeps the sidebar visible", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Sidebar hello" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-sidebar"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
