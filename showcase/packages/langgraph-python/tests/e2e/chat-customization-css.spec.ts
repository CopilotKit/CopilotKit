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

    // Read the three most distinctive CSS variables straight off the scope
    // element. If theme.css didn't load (or its `.chat-css-demo-scope`
    // selector didn't match) these would resolve to empty strings.
    const vars = await scope.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        primary: cs.getPropertyValue("--copilot-kit-primary-color").trim(),
        background: cs
          .getPropertyValue("--copilot-kit-background-color")
          .trim(),
        secondary: cs.getPropertyValue("--copilot-kit-secondary-color").trim(),
      };
    });

    expect(vars.primary.toLowerCase()).toBe("#ff006e");
    expect(vars.background.toLowerCase()).toBe("#fff8f0");
    expect(vars.secondary.toLowerCase()).toBe("#fde047");
  });

  test("input textarea inherits Georgia serif font from theme.css", async ({
    page,
  }) => {
    // theme.css sets `.copilotKitInput > textarea { font-family: "Georgia", ... }`.
    // The default CopilotKit textarea does not set Georgia — asserting on
    // this one computed property is a reliable theme-applied signal that
    // doesn't collide with utility classes the way `border-style` does.
    const textarea = page
      .locator(".chat-css-demo-scope .copilotKitInput textarea")
      .first();
    await expect(textarea).toBeVisible();
    const fontFamily = await textarea.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    expect(fontFamily).toMatch(/Georgia/);
  });

  test("user bubble uses hot pink gradient after sending a message", async ({
    page,
  }) => {
    // "hello" matches an existing aimock fixture (content response), so this
    // exercises a full round-trip through the themed chat and lets us assert
    // on the rendered user bubble's computed background.
    await page.getByPlaceholder("Type a message").fill("hello");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const userMsg = page
      .locator('.chat-css-demo-scope [data-testid="copilot-user-message"]')
      .first();
    await expect(userMsg).toBeVisible({ timeout: 30000 });

    // theme.css sets the user bubble background to
    // `linear-gradient(135deg, #ff006e 0%, #c2185b 100%)`. Read the computed
    // `background-image` directly — covers both the gradient presence and
    // the starting color.
    const bgImage = await userMsg.evaluate(
      (el) => getComputedStyle(el).backgroundImage,
    );
    expect(bgImage).toContain("linear-gradient");
    expect(bgImage).toContain("rgb(255, 0, 110)");
  });

  test("assistant bubble uses amber background after round-trip", async ({
    page,
  }) => {
    await page.getByPlaceholder("Type a message").fill("hello");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const assistant = page
      .locator('.chat-css-demo-scope [data-testid="copilot-assistant-message"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: 45000 });

    // theme.css sets the assistant bubble background to `#fde047`
    // (rgb(253, 224, 71)). The default CopilotKit assistant bubble has no
    // background-color, so a mismatch proves the theme lost the cascade.
    await expect(assistant).toHaveCSS("background-color", "rgb(253, 224, 71)");
  });
});
