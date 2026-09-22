import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("scope wrapper and themed chat input render on load", async ({
    page,
  }) => {
    // The `.chat-css-demo-scope` wrapper is where all `--copilot-kit-*` CSS
    // variable overrides are applied. Its presence is the defining signal
    // that theme.css is loaded and scoped correctly.
    const scope = page.locator(".chat-css-demo-scope");
    await expect(scope).toBeVisible();

    // v2 CopilotChat exposes its input via data-testid regardless of theme
    // overrides. Use the testid plus the default placeholder to assert the
    // themed input mounted.
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
    // wrapper. If theme.css didn't load (or its `.chat-css-demo-scope`
    // selector didn't match) these would resolve to empty strings.
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

  test("input textarea inherits Inter Tight sans font from theme.css", async ({
    page,
  }) => {
    // theme.css sets `.copilotKitInput textarea { font-family: var(--halcyon-sans) }`
    // which resolves to "Inter Tight", .... The default CopilotKit textarea
    // does not set Inter Tight — asserting on this computed property is a
    // reliable theme-applied signal.
    const textarea = page
      .locator(".chat-css-demo-scope .copilotKitInput textarea")
      .first();
    await expect(textarea).toBeVisible();
    const fontFamily = await textarea.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    expect(fontFamily).toMatch(/Inter Tight/);
  });

  test("user bubble uses transparent background with ember left-border after sending a message", async ({
    page,
  }) => {
    // Use a message that matches an aimock fixture to get a deterministic
    // response. Lowercase "hello" doesn't reliably match — "Say hello in
    // one short sentence" is an exact d5-all.json fixture entry.
    await page
      .getByPlaceholder("Type a message")
      .fill("Say hello in one short sentence");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const userMsg = page
      .locator('.chat-css-demo-scope [data-testid="copilot-user-message"]')
      .first();
    await expect(userMsg).toBeVisible({ timeout: 30000 });

    // The Halcyon theme sets the user message outer wrapper to
    // `background: transparent` and styles the inner bg-muted child with
    // `var(--halcyon-paper-elevated)` (#fbf8f2) plus a 2px ember left border.
    // Assert the outer wrapper is transparent.
    await expect(userMsg).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("assistant bubble uses transparent background after round-trip", async ({
    page,
  }) => {
    await page
      .getByPlaceholder("Type a message")
      .fill("Tell me a one-line joke");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const assistant = page
      .locator('.chat-css-demo-scope [data-testid="copilot-assistant-message"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: 45000 });

    // The Halcyon theme sets the assistant message to
    // `background: transparent` — editorial serif text with no bubble, just
    // an ember left-rule via ::before. The default CopilotKit assistant has
    // a visible background, so transparent proves the theme won the cascade.
    await expect(assistant).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });
});
