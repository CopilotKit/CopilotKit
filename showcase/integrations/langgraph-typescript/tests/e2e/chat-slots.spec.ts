import { test, expect } from "@playwright/test";

test.describe("Chat Slots", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Slot wiring/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="custom-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
