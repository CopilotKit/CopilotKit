import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("scoped wrapper class is present", async ({ page }) => {
    const scope = page.locator(".chat-css-demo-scope");
    await expect(scope).toHaveCount(1);
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Theme check suggestion pill renders a scoped user message", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Theme check" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page
        .locator('.chat-css-demo-scope [data-testid="copilot-user-message"]')
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
