import { test, expect } from "@playwright/test";

// Behavioral e2e for the declarative-json-render demo (OpenClaw), run against
// aimock (deterministic LLM). The gateway injects X-AIMock-Context: openclaw,
// so these prompts match the fixtures in showcase/aimock/d4/openclaw/chat.json.
//
// This demo is CONTENT-driven, not tool-driven: the model returns a
// `@json-render/react` flat-spec object ({ root, elements }) as the assistant
// message *content*. The `JsonRenderAssistantMessage` slot parses that content
// and, when it is a valid spec, renders the tree (json-render-root wrapper +
// MetricCard / BarChart / PieChart components). No tool-call loop, so no
// "returned:" terminator fixture is needed.
//
// PARITY_NOTES lists declarative-json-render as a "known gap" only because the
// REAL gateway does not yet inject the json-render envelope system prompt. That
// caveat is about live-model reliability; aimock bypasses it entirely by
// returning the canned spec as content, so the frontend rendering is driven
// deterministically here.
test.describe("Declarative UI: json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/declarative-json-render");
  });

  test("page loads with chat composer and suggestion pills", async ({
    page,
  }) => {
    // CopilotChat default composer placeholder is "Type a message...".
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20000,
    });

    // Suggestion pills driven by useConfigureSuggestions.
    for (const title of [
      "Sales dashboard",
      "Revenue by category",
      "Expense trend",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("sales dashboard request renders a json-render tree", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Show me the sales dashboard with metrics and a revenue chart",
    );
    await input.press("Enter");

    // The JsonRenderAssistantMessage slot wraps a valid spec in this testid.
    await expect(
      page.locator('[data-testid="json-render-root"]').first(),
    ).toBeVisible({ timeout: 30000 });

    // The sales-dashboard fixture nests a BarChart under a MetricCard root.
    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="bar-chart"]').first()).toBeVisible(
      { timeout: 30000 },
    );

    // Fixture-specific values prove the aimock spec drove the render.
    const root = page.locator('[data-testid="json-render-root"]').first();
    await expect(root.getByText("Revenue (Q3)")).toBeVisible();
    await expect(root.getByText("$1.24M")).toBeVisible();
  });

  test("revenue-by-category request renders a pie chart", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Break down revenue by category as a pie chart");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="json-render-root"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="pie-chart"]').first()).toBeVisible(
      { timeout: 30000 },
    );

    // Fixture-specific slice labels. Scope to the rendered tree so the
    // "Revenue by category" suggestion pill (same text) can't shadow the assert.
    const root = page.locator('[data-testid="json-render-root"]').first();
    await expect(root.getByText("Revenue by category")).toBeVisible();
    await expect(root.getByText("Enterprise")).toBeVisible();
  });

  test("expense-trend request renders a bar chart", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Show me monthly expenses as a bar chart");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="json-render-root"]').first(),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="bar-chart"]').first()).toBeVisible(
      { timeout: 30000 },
    );

    // Fixture-specific title.
    const root = page.locator('[data-testid="json-render-root"]').first();
    await expect(root.getByText("Monthly expenses")).toBeVisible();
  });
});
