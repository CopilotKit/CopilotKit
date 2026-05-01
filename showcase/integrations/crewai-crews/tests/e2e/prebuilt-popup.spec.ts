import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("main content heading renders", async ({ page }) => {
    await expect(
      page.getByText("Popup demo — look for the floating launcher"),
    ).toBeVisible();
  });

  test("popup is open by default", async ({ page }) => {
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Popup hello suggestion pill keeps the popup visible", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Popup hello" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-popup"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
