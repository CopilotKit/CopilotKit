import { test, expect } from "@playwright/test";

// Canonical e2e suggestion pill — message must match
// showcase/aimock/_canonical-catalog.json (frozen) for chat-customization-css.
test.describe("Chat Customization (CSS) — canonical suggestion pill", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("Theme check suggestion pill fires the catalog prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Theme check/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.getByText("verify the css theme rendering"),
    ).toBeVisible({ timeout: 30_000 });
  });
});
