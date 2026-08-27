import { test, expect } from "@playwright/test";

// Tool-Based Generative UI demo: a centered <CopilotChat> with two
// useComponent registrations (render_bar_chart + render_pie_chart) plus
// three suggestion pills wired via useConfigureSuggestions. The demo
// has no header / chrome — the chat surface IS the page.
test.describe("Tool-Based Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-tool-based");
  });

  test("page loads with chat composer and the three suggestion pills", async ({
    page,
  }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });

    for (const title of [
      "Sales bar chart",
      "Traffic pie chart",
      "Market share",
    ]) {
      await expect(
        page
          .locator('[data-testid="copilot-suggestion"]')
          .filter({ hasText: title }),
      ).toBeVisible({ timeout: 15000 });
    }
  });

  test("pie chart request renders SVG visualization", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Show me a pie chart of revenue by category");
    await input.press("Enter");

    // PieChart renders as Recharts SVG inside the assistant message.
    const assistantMessage = page
      .locator('[data-testid="copilot-assistant-message"]')
      .first();
    await expect(assistantMessage.locator("svg").first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("bar chart request renders SVG visualization", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Show me a bar chart of monthly expenses");
    await input.press("Enter");

    const assistantMessage = page
      .locator('[data-testid="copilot-assistant-message"]')
      .first();
    await expect(assistantMessage.locator("svg").first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("Hello");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
