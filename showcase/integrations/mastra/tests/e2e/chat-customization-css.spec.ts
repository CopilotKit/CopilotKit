import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test("scoped wrapper is present", async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
    await expect(page.locator(".chat-css-demo-scope")).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
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
