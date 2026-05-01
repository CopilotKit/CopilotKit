import { test, expect } from "@playwright/test";

// Canonical e2e suggestion coverage for the chat-slots demo.
// Pill title + message come from showcase/aimock/_canonical-catalog.json.
test.describe("Chat Slots — canonical pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("Slot wiring canonical pill fires the catalog message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Slot wiring/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
