import { test, expect } from "@playwright/test";

/**
 * E2E spec for BYOC json-render — authored in Wave 4b but NOT yet run
 * against Railway. The Playwright pass is deferred to post-deploy
 * stabilization (see `docs/superpowers/plans/2026-04-23-wave4b-byoc-json-render-demo.md`
 * Task 12 scope note).
 *
 * Structurally mirrors `gen-ui-tool-based.spec.ts` so the agent
 * dashboard's Wave 4a/4b rows exercise the same surfaces.
 */
test.describe("BYOC json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("page loads with chat composer and suggestion pills", async ({
    page,
  }) => {
    // Chat composer
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });

    // Suggestion pills driven by useConfigureSuggestions. The
    // CopilotChat welcome screen renders titles as buttons/links.
    await expect(page.getByText("Sales dashboard")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("Revenue by category")).toBeVisible();
    await expect(page.getByText("Expense trend")).toBeVisible();
  });

  test("sales dashboard request renders a json-render tree", async ({
    page,
  }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill(
      "Show me the sales dashboard with metrics and a revenue chart",
    );
    await input.press("Enter");

    // The JsonRenderAssistantMessage slot wraps renders in this testid.
    await expect(
      page.locator('[data-testid="json-render-root"]').first(),
    ).toBeVisible({ timeout: 60000 });

    // A MetricCard should appear in the rendered tree.
    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 60000 });

    // ...plus at least one chart (either shape).
    await expect(
      page
        .locator('[data-testid="bar-chart"], [data-testid="pie-chart"]')
        .first(),
    ).toBeVisible({ timeout: 60000 });
  });

  test("revenue-by-category request renders a pie chart", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Break down revenue by category as a pie chart");
    await input.press("Enter");

    await expect(page.locator('[data-testid="pie-chart"]').first()).toBeVisible(
      { timeout: 60000 },
    );
  });

  test("expense-trend request renders a bar chart", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Show me monthly expenses as a bar chart");
    await input.press("Enter");

    await expect(page.locator('[data-testid="bar-chart"]').first()).toBeVisible(
      { timeout: 60000 },
    );
  });
});
