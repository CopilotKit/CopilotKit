import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Every rule in theme.css is scoped to this wrapper.
const SCOPE = ".chat-css-demo-scope";

function sendButton(page: Page) {
  return page.locator('[data-testid="copilot-send-button"]').first();
}

describeDemo("chat-customization-css", "Chat Customization (CSS)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("chat-customization-css"));
  });

  test("scope wrapper and themed chat input render on load", async ({
    page,
  }) => {
    const scope = page.locator(SCOPE);
    await expect(scope).toBeVisible();

    // The v2 CopilotChat input keeps its data-testid when a theme overrides
    // its look. The testid and the default placeholder show that the themed
    // input mounted.
    await expect(
      scope.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("CSS variables from theme.css resolve on the scope wrapper", async ({
    page,
  }) => {
    const scope = page.locator(SCOPE);
    await expect(scope).toBeVisible();

    // The HALCYON theme sets --halcyon-* custom properties on the scope
    // wrapper. If theme.css did not load, or its `.chat-css-demo-scope`
    // selector did not match, these values are empty strings.
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
    // theme.css sets `.copilotKitInput textarea { font-family: var(--halcyon-sans) }`,
    // which resolves to "Inter Tight" first. The default CopilotKit textarea
    // does not use Inter Tight, so this computed value shows that the theme
    // applied.
    const textarea = page.locator(`${SCOPE} .copilotKitInput textarea`).first();
    await expect(textarea).toBeVisible();
    const fontFamily = await textarea.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    expect(fontFamily).toMatch(/Inter Tight/);
  });

  test("user bubble uses transparent background with ember left-border after sending a message", async ({
    page,
  }) => {
    // The message matches an aimock fixture exactly, so the reply is
    // deterministic. A lowercase "hello" does not match reliably.
    await page
      .getByPlaceholder("Type a message")
      .fill("Say hello in one short sentence");
    await sendButton(page).click();

    const userMsg = page
      .locator(`${SCOPE} [data-testid="copilot-user-message"]`)
      .first();
    await expect(userMsg).toBeVisible({ timeout: 30000 });

    // The HALCYON theme makes the outer wrapper of the user message
    // transparent. It styles the inner bg-muted child with
    // var(--halcyon-paper-elevated) (#fbf8f2) and a 2px ember left border.
    // The test checks that the outer wrapper is transparent.
    await expect(userMsg).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("assistant bubble uses transparent background after round-trip", async ({
    page,
  }) => {
    await page
      .getByPlaceholder("Type a message")
      .fill("Tell me a one-line joke");
    await sendButton(page).click();

    const assistant = page
      .locator(`${SCOPE} [data-testid="copilot-assistant-message"]`)
      .first();
    await expect(assistant).toBeVisible({ timeout: 45000 });

    // The HALCYON theme makes the assistant message transparent: serif text
    // with no bubble, and an ember rule on the left from ::before. The
    // default assistant message has a visible background, so a transparent
    // one shows that the theme won the cascade.
    await expect(assistant).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });
});
