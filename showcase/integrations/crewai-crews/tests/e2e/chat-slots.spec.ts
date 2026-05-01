import { test, expect } from "@playwright/test";

test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("custom welcome screen renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="custom-welcome-screen"]'),
    ).toBeVisible();
    await expect(page.getByText("Welcome to the Slots demo")).toBeVisible();
  });

  test("custom disclaimer is visible", async ({ page }) => {
    await expect(
      page.locator('[data-testid="custom-disclaimer"]'),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Slot wiring suggestion pill renders the custom assistant message", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Slot wiring" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="custom-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
