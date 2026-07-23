import { test, expect } from "@playwright/test";

// Behavioral e2e for the chat-customization-css demo (OpenClaw), run against
// aimock. All visual overrides live in theme.css, scoped under
// `.chat-css-demo-scope`. Prompts match showcase/aimock/d4/openclaw/chat.json.
test.describe("Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("scope wrapper and themed chat input render on load", async ({
    page,
  }) => {
    const scope = page.locator(".chat-css-demo-scope");
    await expect(scope).toBeVisible({ timeout: 20000 });

    await expect(
      scope.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("CSS variables from theme.css resolve on the scope wrapper", async ({
    page,
  }) => {
    const scope = page.locator(".chat-css-demo-scope");
    await expect(scope).toBeVisible();

    // The Halcyon theme sets --halcyon-* custom properties on the scope
    // wrapper. Empty strings would mean theme.css never loaded / matched.
    const vars = await scope.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        ember: cs.getPropertyValue("--halcyon-ember").trim(),
        paper: cs.getPropertyValue("--halcyon-paper").trim(),
        ink: cs.getPropertyValue("--halcyon-ink").trim(),
      };
    });

    expect(vars.ember.toLowerCase()).toBe("#c44a1f");
    expect(vars.paper.toLowerCase()).toBe("#f4efe6");
    expect(vars.ink.toLowerCase()).toBe("#1a1714");
  });

  test("sending a message produces a themed assistant response", async ({
    page,
  }) => {
    await page
      .getByPlaceholder("Type a message")
      .fill("Say hello in one short sentence");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const assistant = page
      .locator('.chat-css-demo-scope [data-testid="copilot-assistant-message"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: 30000 });

    // The Halcyon theme makes the assistant bubble transparent (editorial
    // serif text, no bubble) — proving the theme won the cascade.
    await expect(assistant).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });
});
