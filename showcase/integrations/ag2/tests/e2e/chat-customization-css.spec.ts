import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test("scoped theme wrapper is applied", async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
    await expect(page.locator(".chat-css-demo-scope")).toBeVisible();
  });

  // Canonical e2e suggestion — single "Theme check" pill from
  // _canonical-catalog.json. Asserts the scoped user-message selector
  // mirrors the catalog's primary observable.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/chat-customization-css");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Theme check" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(
      page
        .locator(
          '.chat-css-demo-scope [data-testid="copilot-user-message"]',
        )
        .first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
