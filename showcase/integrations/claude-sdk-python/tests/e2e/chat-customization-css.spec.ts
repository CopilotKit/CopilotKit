import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("scoped wrapper applies CopilotKit variable override", async ({
    page,
  }) => {
    const scope = page.locator(".chat-css-demo-scope").first();
    await expect(scope).toBeVisible();

    // The --copilot-kit-primary-color variable should resolve to #ff006e
    // inside the scoped wrapper.
    const primary = await scope.evaluate((el) =>
      getComputedStyle(el)
        .getPropertyValue("--copilot-kit-primary-color")
        .trim(),
    );
    expect(primary).toBe("#ff006e");
  });

  test("chat input is present", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 10000,
    });
  });

  test("Theme check suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
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
