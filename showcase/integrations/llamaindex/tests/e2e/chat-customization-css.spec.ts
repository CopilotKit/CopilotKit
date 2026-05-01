import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test("page loads with themed scope wrapper", async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
    await expect(page.locator(".chat-css-demo-scope")).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("canonical 'Theme check' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    await page.goto("/demos/chat-customization-css");
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
