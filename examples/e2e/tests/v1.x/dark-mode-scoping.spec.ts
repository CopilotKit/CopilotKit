/**
 * Regression test for #2920 — .dark CSS selectors must be scoped to CopilotKit
 * elements, not leak into the host application.
 *
 * Before the fix (main), selectors like `.dark, html.dark, body.dark` applied
 * `color: white` and `color: rgb(69, 69, 69)` directly to the .dark element
 * itself, cascading into every child — including host app content.
 *
 * After the fix (#3850), selectors are scoped:
 *   `.dark .copilotKitDevConsole .copilotKitDebugMenuTriggerButton`
 *   `.dark .poweredBy`
 * so only CopilotKit elements receive the dark mode overrides.
 */
import { test, expect } from "@playwright/test";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";

test.describe("dark mode CSS scoping (#2920)", () => {
  // This test relies on an app that uses .dark class (e.g. form-filling)
  test.skip(EXAMPLE !== "form-filling", `EXAMPLE=${EXAMPLE}`);

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator(".copilotKitWindow.open").waitFor({ timeout: 10_000 });
  });

  test("enabling .dark class does not leak CopilotKit styles to host elements", async ({
    page,
  }) => {
    // Grab a host-app element that should never be styled by CopilotKit CSS.
    // In form-filling the <body> itself or a top-level container works.
    const body = page.locator("body");

    // Toggle dark mode by adding .dark to <html>
    await page.evaluate(() => document.documentElement.classList.add("dark"));

    // Wait a tick for styles to recompute
    await page.waitForTimeout(100);

    const colorAfter = await body.evaluate(
      (el) => window.getComputedStyle(el).color,
    );

    // The bug on main: .dark { color: rgb(69, 69, 69) !important } would
    // override the body's color. With the fix, the body color should be
    // determined solely by the host app's own .dark styles, NOT by CopilotKit.
    //
    // We verify the body color is NOT rgb(69, 69, 69) — the specific value
    // that the broken CopilotKit input.css `.dark` rule forced.
    expect(colorAfter).not.toBe("rgb(69, 69, 69)");
  });

  test("CopilotKit poweredBy gets correct dark mode color", async ({
    page,
  }) => {
    // Toggle dark mode
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(100);

    const poweredBy = page.locator(".poweredBy");

    // With the fix, .dark .poweredBy { color: rgb(69, 69, 69) !important }
    // should apply to the poweredBy element specifically.
    const count = await poweredBy.count();
    test.skip(count === 0, "No .poweredBy element found — skipping");

    const color = await poweredBy
      .first()
      .evaluate((el) => window.getComputedStyle(el).color);
    expect(color).toBe("rgb(69, 69, 69)");
  });

  test("screenshot: dark mode side-by-side comparison", async ({ page }) => {
    // Light mode screenshot
    await page.evaluate(() =>
      document.documentElement.classList.remove("dark"),
    );
    await page.waitForTimeout(200);
    const lightScreenshot = await page.screenshot({ fullPage: true });
    expect(lightScreenshot).toBeTruthy();

    // Dark mode screenshot
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    const darkScreenshot = await page.screenshot({ fullPage: true });
    expect(darkScreenshot).toBeTruthy();

    // Visual regression: dark mode screenshot should differ from light mode
    // (if they're identical, dark mode styles aren't applying at all)
    expect(Buffer.compare(lightScreenshot, darkScreenshot)).not.toBe(0);
  });

  test("dark mode styles only target CopilotKit elements", async ({ page }) => {
    // Add a marker element outside CopilotKit to detect style leaks
    await page.evaluate(() => {
      const marker = document.createElement("div");
      marker.id = "leak-detector";
      marker.textContent = "Leak detector";
      document.body.prepend(marker);
    });

    // Enable dark mode
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(100);

    const markerColorDark = await page
      .locator("#leak-detector")
      .evaluate((el) => window.getComputedStyle(el).color);

    // The leak detector element should NOT have its color changed by
    // CopilotKit's .dark CSS rules. If it does, that's a style leak.
    //
    // Note: The host app's own .dark { --foreground: ... } will change colors
    // via CSS variables, which is fine. What we're checking is that
    // CopilotKit doesn't force rgb(69, 69, 69) or white via its own rules.
    expect(markerColorDark).not.toBe("rgb(69, 69, 69)");
  });
});
