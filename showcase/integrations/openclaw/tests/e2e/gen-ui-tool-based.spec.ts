import { test, expect } from "@playwright/test";

// Behavioral e2e for the gen-ui-tool-based demo (OpenClaw), run against aimock.
//
// This demo registers ONE frontend tool with a `render` function via
// `useFrontendTool`: `render_chart(chartType, title, description, data)`. The
// tool has no handler — its only job is to paint UI. When the OpenClaw agent
// calls `render_chart`, CopilotChat drives the render function through its
// inProgress -> executing -> complete lifecycle, and it draws a bar or pie
// chart from the arguments (chart-card.tsx):
//   data-testid="gen-ui-chart-card"   (outer, with data-chart-type / data-status)
//   data-testid="gen-ui-chart-title"
//   data-testid="gen-ui-bar-chart"    (bar variant)
//   data-testid="gen-ui-pie-chart"    (pie variant)
//
// The load-bearing assertion is that the rendered chart component appears — the
// generative UI is the tool's render output, not LLM text. Prompts match
// showcase/aimock/d4/openclaw/chat.json. The existing "returned:" terminator
// fixture closes the tool turn, so only the first-call tool fixture is needed.
test.describe("Tool-Based Generative UI (render_chart)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-tool-based");
  });

  test("page loads with chat input and chart suggestions", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 20000,
    });
    for (const title of [
      "Sales bar chart",
      "Traffic pie chart",
      "Market share",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("'Sales bar chart' pill renders a bar chart component", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Sales bar chart" }).click();

    const card = page.locator('[data-testid="gen-ui-chart-card"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(card).toHaveAttribute("data-chart-type", "bar");
    await expect(
      card.locator('[data-testid="gen-ui-bar-chart"]'),
    ).toBeVisible();
  });

  test("'Traffic pie chart' pill renders a pie chart component", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Traffic pie chart" }).click();

    const card = page.locator('[data-testid="gen-ui-chart-card"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(card).toHaveAttribute("data-chart-type", "pie");
    await expect(
      card.locator('[data-testid="gen-ui-pie-chart"]'),
    ).toBeVisible();
  });

  test("typing a chart prompt renders a chart component", async ({ page }) => {
    const input = page.getByRole("textbox").first();
    await input.fill("Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4.");
    await input.press("Enter");

    const card = page.locator('[data-testid="gen-ui-chart-card"]').first();
    await expect(card).toBeVisible({ timeout: 45000 });
    await expect(
      card.locator('[data-testid="gen-ui-chart-title"]'),
    ).toBeVisible();
  });
});
