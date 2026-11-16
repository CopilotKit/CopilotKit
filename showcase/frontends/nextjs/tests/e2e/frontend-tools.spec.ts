import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/frontend-tools/page.tsx
//
// The demo registers ONE frontend tool via `useFrontendTool`:
// `change_background(background: string)`. The handler calls `setBackground`
// with a CSS value: a gradient or a solid color. The background host
// (`data-testid="frontend-tools-background"`) starts at `#4f46e5` (solid
// indigo), and the tool changes its inline style.
//
// The tests assert on that side effect (the inline style), not on any
// LLM-generated text. The demo shows three suggestion pills: "Sunset theme",
// "Forest theme" and "Cosmic theme". The aimock fixtures answer the pill
// prompts.

const DEFAULT_BACKGROUND = "#4f46e5";
const TOOL_TIMEOUT = 45000;

function background(page: Page) {
  return page.locator('[data-testid="frontend-tools-background"]');
}

async function backgroundStyle(page: Page) {
  return (await background(page).getAttribute("style")) ?? "";
}

describeDemo("frontend-tools", "Frontend Tools (change_background)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("frontend-tools"));
  });

  test("page loads with chat input and background container", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(background(page)).toBeVisible();
  });

  test("background container starts with the solid indigo default", async ({
    page,
  }) => {
    expect(await backgroundStyle(page)).toContain(DEFAULT_BACKGROUND);
  });

  test("suggestion pills for Sunset, Forest, and Cosmic themes render", async ({
    page,
  }) => {
    for (const name of [/Sunset theme/i, /Forest theme/i, /Cosmic theme/i]) {
      await expect(page.getByRole("button", { name })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("Forest theme pill mutates the background inline style", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Forest theme/i }).click();

    // The inline style moves away from the default once the agent calls
    // change_background.
    await expect
      .poll(
        async () => !(await backgroundStyle(page)).includes(DEFAULT_BACKGROUND),
        { timeout: TOOL_TIMEOUT },
      )
      .toBe(true);
  });

  test("Sunset theme pill triggers a gradient change", async ({ page }) => {
    // The pill sends the prompt "Make the background a sunset gradient."
    await page.getByRole("button", { name: /Sunset theme/i }).click();

    // `linear-gradient` is the common case for the sunset theme;
    // `radial-gradient` is also accepted.
    await expect
      .poll(
        async () =>
          /linear-gradient|radial-gradient/.test(await backgroundStyle(page)),
        { timeout: TOOL_TIMEOUT },
      )
      .toBe(true);
  });
});
