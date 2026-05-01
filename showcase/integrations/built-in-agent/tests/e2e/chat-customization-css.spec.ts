import { test, expect } from "@playwright/test";

// E2E for the chat-customization-css demo — exercises the canonical
// suggestion pill registered by `useConfigureSuggestions` in page.tsx.

test.describe("Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Theme check/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page
        .locator(
          '.chat-css-demo-scope [data-testid="copilot-user-message"]',
        )
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
