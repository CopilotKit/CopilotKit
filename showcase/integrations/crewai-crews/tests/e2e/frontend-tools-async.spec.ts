import { test, expect } from "@playwright/test";

test.describe("Frontend Tools (Async)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Async metric suggestion pill renders the notes card", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Async metric" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="notes-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
