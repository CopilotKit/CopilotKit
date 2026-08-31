import { test, expect } from "@playwright/test";

// QA reference: qa/frontend-tools.md
// Demo source: src/app/demos/frontend-tools/page.tsx
//
// The demo registers ONE frontend tool via `useFrontendTool`:
// `change_background(background: string)`. The handler calls `setBackground`
// with a CSS value — gradient or solid color. The background host
// (`data-testid="frontend-tools-background"`) starts at `#4f46e5` (solid
// indigo) and mutates inline on success.
//
// We assert on the observable side effect (inline style changes) rather
// than on any LLM-generated text. The demo exposes three suggestion pills:
// "Sunset theme", "Forest theme", and "Cosmic theme". The existing aimock
// feature-parity fixture covers the "sunset-themed gradient" prompt, and
// the real Railway LLM handles the free-form prompts.

test.describe("Frontend Tools (change_background)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools");
  });

  test("page loads with chat input and background container", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="frontend-tools-background"]'),
    ).toBeVisible();
  });

  test("background container starts with the solid indigo default", async ({
    page,
  }) => {
    const bg = page.locator('[data-testid="frontend-tools-background"]');
    // The initial inline style is #4f46e5 (solid indigo, from background.tsx).
    const initial = await bg.getAttribute("style");
    expect(initial ?? "").toContain("#4f46e5");
  });

  test("suggestion pills for Sunset, Forest, and Cosmic themes render", async ({
    page,
  }) => {
    await expect(
      page.getByRole("button", { name: /Sunset theme/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: /Forest theme/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: /Cosmic theme/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("Forest theme pill mutates the background inline style", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Forest theme/i }).click();

    const bg = page.locator('[data-testid="frontend-tools-background"]');

    // The inline style flips away from the #4f46e5 default once the
    // agent invokes change_background. Poll the style attribute rather
    // than any LLM text.
    await expect
      .poll(
        async () => {
          const s = (await bg.getAttribute("style")) ?? "";
          return !s.includes("#4f46e5");
        },
        { timeout: 45000 },
      )
      .toBe(true);
  });

  test("Sunset theme pill triggers a gradient change", async ({ page }) => {
    // The pill sends the verbatim prompt "Make the background a sunset
    // gradient." — aimock fixture covers this; real LLM handles it on Railway.
    await page.getByRole("button", { name: /Sunset theme/i }).click();

    const bg = page.locator('[data-testid="frontend-tools-background"]');

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
