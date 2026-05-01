import { test, expect } from "@playwright/test";

test.describe("Chat Slots", () => {
  test("custom welcome screen and disclaimer slot render", async ({ page }) => {
    await page.goto("/demos/chat-slots");
    await expect(
      page.locator('[data-testid="custom-welcome-screen"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="custom-disclaimer"]'),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — single "Slot wiring" pill from
  // _canonical-catalog.json. Verifies the custom assistant message slot
  // renders the canonical response.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/chat-slots");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Slot wiring" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="custom-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });
});
