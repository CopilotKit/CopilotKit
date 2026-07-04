import { test, expect } from "@playwright/test";

// Behavioral e2e for the frontend-tools-async demo (OpenClaw), run against
// aimock.
//
// The demo registers ONE frontend tool via `useFrontendTool`:
// `change_background_async(background: string)` — same story as the
// frontend-tools demo, but the handler is ASYNC (awaits a simulated 500ms
// client-side round-trip before applying the background). OpenClaw does a
// multi-call tool loop: call #1 (hasToolResult: false) returns a
// change_background_async toolCall, the local async handler awaits then runs
// setBackground(...); the flattened tool follow-up is closed by the shared
// "returned:" terminator fixture. The background host
// (data-testid="frontend-tools-async-background") starts at #4f46e5 (solid
// indigo) and mutates its inline style on success — that observable side
// effect is the load-bearing assertion (no LLM text). Prompts match
// showcase/aimock/d4/openclaw/chat.json.
test.describe("Frontend Tools Async (change_background_async)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
  });

  test("page loads with chat input and the indigo default background", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20000,
    });
    const bg = page.locator('[data-testid="frontend-tools-async-background"]');
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

    const bg = page.locator('[data-testid="frontend-tools-async-background"]');
    // The async handler awaits ~500ms, then the fixture toolCall's
    // linear-gradient is applied. Poll the inline style / the
    // data-background-value rather than any LLM text.
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

    const bg = page.locator('[data-testid="frontend-tools-async-background"]');
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
