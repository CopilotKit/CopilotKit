import { test, expect } from "@playwright/test";

test.describe("Gen UI Interrupt", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-interrupt");
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Pause and pick suggestion pill renders the time-picker card", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Pause and pick" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="time-picker-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
