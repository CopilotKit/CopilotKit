import { test, expect } from "@playwright/test";

// Behavioral e2e for the declarative-hashbrown demo (OpenClaw), run against
// aimock (deterministic LLM). The gateway injects X-AIMock-Context: openclaw,
// so these suggestion prompts match the fixtures in
// showcase/aimock/d4/openclaw/chat.json.
//
// Unlike the tool-based demos, hashbrown is NOT a tool-call loop: the assistant
// returns a catalog-constrained `{ "ui": [...] }` JSON envelope as plain
// message CONTENT. `hashbrown-renderer.tsx` overrides the assistant-message
// slot with `useJsonParser`, which streams that envelope into MetricCard /
// PieChart / BarChart components. Each component carries a stable data-testid
// (metric-card / pie-chart / bar-chart) — those rendered nodes are the
// load-bearing assertions (no LLM prose to match). Because there is no tool
// round-trip, no "returned:" terminator fixture is involved here.
//
// The three suggestion pills (registered via useConfigureSuggestions) render as
// buttons whose accessible name is the pill LABEL, but clicking one sends the
// full PROMPT — which is the exact string the fixture matches on.
test.describe("Declarative UI: Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/declarative-hashbrown");
  });

  test("page loads with header and the three suggestion pills", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Declarative UI: Hashbrown" }),
    ).toBeVisible();

    for (const label of [
      "Sales dashboard",
      "Revenue by category",
      "Expense trend",
    ]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("Sales dashboard suggestion renders a metric card plus a chart", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Sales dashboard" }).click();

    // The fixture envelope contains a `metric` + `pieChart` + `barChart`.
    // Timeouts are streaming-friendly because useJsonParser assembles the UI
    // progressively from the streamed structured output.
    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 60000 });

    const chart = page
      .locator('[data-testid="pie-chart"], [data-testid="bar-chart"]')
      .first();
    await expect(chart).toBeVisible({ timeout: 60000 });

    // Fixture-specific content proves the aimock envelope drove the render.
    await expect(page.getByText("Total Revenue").first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByText("$1.2M").first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("Revenue by category suggestion renders a pie chart", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Revenue by category" }).click();

    await expect(
      page.locator('[data-testid="pie-chart"]').first(),
    ).toBeVisible({ timeout: 60000 });

    // The pie-chart legend renders the fixture segment labels.
    await expect(page.getByText("Software").first()).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByText("Hardware").first()).toBeVisible({
      timeout: 60000,
    });
  });

  test("Expense trend suggestion renders a bar chart", async ({ page }) => {
    await page.getByRole("button", { name: "Expense trend" }).click();

    await expect(
      page.locator('[data-testid="bar-chart"]').first(),
    ).toBeVisible({ timeout: 60000 });

    // The bar chart's title comes straight from the fixture envelope.
    await expect(
      page.getByText("Monthly Operating Expenses").first(),
    ).toBeVisible({ timeout: 60000 });
  });
});
