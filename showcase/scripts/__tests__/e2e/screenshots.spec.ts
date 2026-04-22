/**
 * Screenshot verification tests for visual layout validation.
 *
 * Takes screenshots at 3 viewports (iPhone SE, iPhone 14 Pro Max, Desktop)
 * for both the starter homepage and self-contained demo pages.
 *
 * Screenshots are saved to test-results/screenshots/ for manual inspection.
 * NEVER trust DOM measurements alone -- always visually inspect screenshots.
 *
 * To run:
 *   cd showcase/scripts
 *   BASE_URL=http://localhost:3000 npx playwright test __tests__/e2e/screenshots.spec.ts
 */

import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-14-pro-max", width: 430, height: 932 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const RENDERER_MODES = [
  { name: "Tool-Based", pill: /Tool-Based/ },
  { name: "A2UI", pill: /A2UI Catalog/ },
  { name: "json-render", pill: /json-render/ },
  { name: "HashBrown", pill: /HashBrown/ },
] as const;

const DEMOS = [
  {
    slug: "agentic-chat",
    path: "/demos/agentic-chat",
    waitFor: '[data-testid="background-container"]',
  },
  {
    slug: "hitl",
    path: "/demos/hitl",
    waitFor: 'text="Type a message"',
  },
  {
    slug: "tool-rendering",
    path: "/demos/tool-rendering",
    waitFor: 'text="Type a message"',
  },
  {
    slug: "gen-ui-agent",
    path: "/demos/gen-ui-agent",
    waitFor: 'text="Type a message"',
  },
  {
    slug: "gen-ui-tool-based",
    path: "/demos/gen-ui-tool-based",
    waitFor: 'text="Type a message"',
  },
  {
    slug: "shared-state-read",
    path: "/demos/shared-state-read",
    waitFor: 'text="Type a message"',
  },
  {
    slug: "shared-state-write",
    path: "/demos/shared-state-write",
    waitFor: 'text="Type a message"',
  },
  {
    slug: "shared-state-streaming",
    path: "/demos/shared-state-streaming",
    waitFor: 'text="Type a message"',
  },
  {
    slug: "subagents",
    path: "/demos/subagents",
    waitFor: 'text="Type a message"',
  },
] as const;

// ---------------------------------------------------------------------------
// Starter homepage screenshots (with renderer switching)
// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  test.describe(`Starter screenshots @ ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
    });

    test("homepage loads and renders", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByText("CopilotKit Sales Dashboard")).toBeVisible({
        timeout: 15000,
      });

      await page.screenshot({
        path: `test-results/screenshots/${viewport.name}-homepage.png`,
        fullPage: true,
      });
    });

    for (const mode of RENDERER_MODES) {
      test(`${mode.name} renderer`, async ({ page }) => {
        await page.goto("/");
        await expect(page.getByText("CopilotKit Sales Dashboard")).toBeVisible({
          timeout: 15000,
        });

        const pill = page.getByRole("radio", { name: mode.pill });
        await pill.click();
        await expect(pill).toHaveAttribute("aria-checked", "true");

        // Allow renderer to mount
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: `test-results/screenshots/${viewport.name}-${mode.name.toLowerCase()}.png`,
          fullPage: true,
        });
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Demo page screenshots
// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  test.describe(`Demo screenshots @ ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
    });

    for (const demo of DEMOS) {
      test(`${demo.slug}`, async ({ page }) => {
        await page.goto(demo.path);
        await page.locator(demo.waitFor).first().waitFor({
          state: "visible",
          timeout: 15000,
        });

        await page.screenshot({
          path: `test-results/screenshots/${viewport.name}-demo-${demo.slug}.png`,
          fullPage: true,
        });
      });
    }
  });
}
