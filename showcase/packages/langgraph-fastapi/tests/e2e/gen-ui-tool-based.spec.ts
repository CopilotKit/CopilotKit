import { test, expect } from "@playwright/test";

test.describe("Tool-Based Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-tool-based");
  });

  test("page loads with sidebar open and instructional text", async ({
    page,
  }) => {
    // The CopilotSidebar should be open with a chat input
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });

    // The instructional text should be visible in the main content area
    await expect(
      page.getByText("Use the sidebar to generate charts"),
    ).toBeVisible();
  });

  test("sidebar header shows Chart Generator title", async ({ page }) => {
    await expect(page.getByText("Chart Generator")).toBeVisible({
      timeout: 10000,
    });
  });

  test("pie chart request renders SVG visualization", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Show me a pie chart of revenue by category");
    await input.press("Enter");

    // PieChart renders as SVG (either custom DonutChart or Recharts)
    await expect(page.locator("svg").first()).toBeVisible({ timeout: 60000 });
  });

  test("bar chart request renders visualization", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Show me a bar chart of monthly expenses");
    await input.press("Enter");

    // BarChart uses Recharts which renders SVG elements
    await expect(page.locator("svg").first()).toBeVisible({ timeout: 60000 });
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });
});
