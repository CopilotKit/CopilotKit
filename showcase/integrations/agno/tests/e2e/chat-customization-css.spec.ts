import { test, expect } from "@playwright/test";

test.describe("Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/chat-customization-css");
  });

  test("scope wrapper and themed chat input render on load", async ({
    page,
  }) => {
    const scope = page.locator(".chat-css-demo-scope");
    await expect(scope).toBeVisible();

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
    const textarea = page
      .locator(".chat-css-demo-scope .copilotKitInput textarea")
      .first();
    await expect(textarea).toBeVisible();
    const fontFamily = await textarea.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    expect(fontFamily).toMatch(/Georgia/);
  });
});
