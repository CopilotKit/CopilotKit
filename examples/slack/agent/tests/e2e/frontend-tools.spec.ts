import { test, expect } from "@playwright/test";

// QA reference: qa/frontend-tools.md
// Demo source: src/app/demos/frontend-tools/page.tsx
//
// The demo registers ONE frontend tool via `useFrontendTool`:
// `change_background(background: string)`. The handler calls `setBackground`
// with a CSS value — gradient or solid color. The background host
// (`data-testid="background-container"`) starts at
// `var(--copilot-kit-background-color)` and mutates inline on success.
//
// We assert on the observable side effect (inline style changes) rather
// than on any LLM-generated text. The demo exposes two suggestion pills:
// "Change background" (prompts "blue-to-purple gradient") and
// "Sunset theme". The existing aimock feature-parity fixture covers the
// "sunset-themed gradient" prompt, and the real Railway LLM handles the
// free-form prompts.

test.describe("Frontend Tools (change_background)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools");
  });

  test("page loads with chat input and background container", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
  });

  test("background container starts with the theme default", async ({
    page,
  }) => {
    const bg = page.locator('[data-testid="background-container"]');
    // The initial inline style is the CSS variable (verbatim in page.tsx).
    const initial = await bg.getAttribute("style");
    expect(initial ?? "").toContain("--copilot-kit-background-color");
  });

  test("suggestion pills for Change background and Sunset theme render", async ({
    page,
  }) => {
    await expect(
      page.getByRole("button", { name: /Change background/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: /Sunset theme/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("blue gradient prompt mutates the background inline style", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Change the background to a linear gradient from blue to purple.",
    );
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const bg = page.locator('[data-testid="background-container"]');

    // The inline style flips away from the CSS variable default once the
    // agent invokes change_background. Poll the style attribute rather
    // than any LLM text.
    await expect
      .poll(
        async () => {
          const s = (await bg.getAttribute("style")) ?? "";
          return s.includes("--copilot-kit-background-color");
        },
        { timeout: 45000 },
      )
      .toBe(false);
  });

  test("Sunset theme pill triggers a gradient change", async ({ page }) => {
    // The pill sends the verbatim prompt "Make the background a sunset-themed
    // gradient." — aimock fixture covers this; real LLM handles it on Railway.
    await page.getByRole("button", { name: /Sunset theme/i }).click();

    const bg = page.locator('[data-testid="background-container"]');

    // Expect a gradient-containing inline style. `linear-gradient` is the
    // common case for the sunset theme; `radial-gradient` is also accepted.
    await expect
      .poll(
        async () => {
          const s = (await bg.getAttribute("style")) ?? "";
          return /linear-gradient|radial-gradient/.test(s);
        },
        { timeout: 45000 },
      )
      .toBe(true);
  });
});
