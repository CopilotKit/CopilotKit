import { test, expect } from "@playwright/test";

// Behavioral e2e for the frontend-tools demo (OpenClaw), run against aimock.
//
// The demo registers ONE frontend tool via `useFrontendTool`:
// `change_background(background: string)`. OpenClaw does a multi-call tool
// loop: call #1 (hasToolResult: false) returns a change_background toolCall,
// the local handler runs setBackground(...), and call #2 (hasToolResult: true)
// returns a text confirmation. The background host
// (data-testid="frontend-tools-background") starts at #4f46e5 (solid indigo)
// and mutates its inline style on success — that observable side effect is the
// load-bearing assertion (no LLM text). Prompts match
// showcase/aimock/d4/openclaw/chat.json.
test.describe("Frontend Tools (change_background)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools");
  });

  test("page loads with chat input and the indigo default background", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20000,
    });
    const bg = page.locator('[data-testid="frontend-tools-background"]');
    await expect(bg).toBeVisible();
    const initial = await bg.getAttribute("style");
    expect(initial ?? "").toContain("#4f46e5");
  });

  test("theme suggestion pills render", async ({ page }) => {
    for (const name of [/Sunset theme/i, /Forest theme/i, /Cosmic theme/i]) {
      await expect(page.getByRole("button", { name })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("Sunset theme pill mutates the background to a gradient", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Sunset theme/i }).click();

    const bg = page.locator('[data-testid="frontend-tools-background"]');
    // The fixture toolCall sets a linear-gradient. Poll the inline style /
    // the data-background-value rather than any LLM text.
    await expect
      .poll(
        async () => {
          const style = (await bg.getAttribute("style")) ?? "";
          const value = (await bg.getAttribute("data-background-value")) ?? "";
          return /gradient/.test(style) || /gradient/.test(value);
        },
        { timeout: 30000 },
      )
      .toBe(true);
  });

  test("Forest theme pill moves the background off the indigo default", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Forest theme/i }).click();

    const bg = page.locator('[data-testid="frontend-tools-background"]');
    await expect
      .poll(
        async () => {
          const style = (await bg.getAttribute("style")) ?? "";
          return !style.includes("#4f46e5");
        },
        { timeout: 30000 },
      )
      .toBe(true);
  });
});
