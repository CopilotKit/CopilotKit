import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Declarative UI: json-render. The checks follow gen-ui-tool-based.spec.ts,
// on the json-render surfaces: json-render-root, metric-card and the charts.
describeDemo("declarative-json-render", "Declarative UI: json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("declarative-json-render"));
  });

  test("page loads with chat composer and suggestion pills", async ({
    page,
  }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });

    // The pills come from useConfigureSuggestions. The CopilotChat welcome
    // screen renders their titles.
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

    // The JsonRenderAssistantMessage slot wraps each render in this testid.
    await expect(
      page.locator('[data-testid="json-render-root"]').first(),
    ).toBeVisible({ timeout: 60000 });

    // A MetricCard in the rendered tree.
    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 60000 });

    // At least one chart, of either kind.
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
