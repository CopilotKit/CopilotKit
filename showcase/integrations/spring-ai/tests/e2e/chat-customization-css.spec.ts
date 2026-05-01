import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test("page loads with scoped wrapper", async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
    await expect(page.locator(".chat-css-demo-scope")).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — single pill wired via useConfigureSuggestions.
  // Title + message come from showcase/aimock/_canonical-catalog.json.
  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Theme check/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page
        .locator('.chat-css-demo-scope [data-testid="copilot-user-message"]')
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
