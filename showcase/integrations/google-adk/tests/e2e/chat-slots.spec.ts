import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for chat-slots.
test.describe("Chat Slots — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-slots");
  });

  test("Slot wiring suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Slot wiring/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.getByText("verify chat slots are wired")).toBeVisible({
      timeout: 30_000,
    });
  });
});
