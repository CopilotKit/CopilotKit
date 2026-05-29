import { test, expect } from "@playwright/test";

/**
 * Headless Chat (Complete) — full headless surface in one demo. The
 * hand-rolled chat shell wires every render hook CopilotKit exposes
 * (useRenderTool, useDefaultRenderTool, useComponent, useRenderToolCall,
 * useSuggestions, useAttachments) on top of shadcn primitives.
 *
 * The 5-test plan drives the 4 empty-state pills and asserts:
 *   - the per-tool render component (Weather / Stock / Highlight / Chart)
 *     is mounted on the headless surface (scoped testid)
 *   - the assistant narration arrives in the custom message-assistant
 *     bubble (`[data-testid="headless-message-assistant"]`)
 *
 * Each pill exercises a DIFFERENT render-hook path. If any hook regresses,
 * only that test fails. If the surface silently demotes back to the default
 * <CopilotChat />, the headless-specific testids vanish and all 4 tool
 * tests fail.
 */

const PILL_WEATHER = "Try suggestion: What's the weather in Tokyo?";
const PILL_STOCK = "Try suggestion: What's AAPL trading at?";
const PILL_HIGHLIGHT = "Try suggestion: Highlight: ship the demo on Friday";
const PILL_CHART =
  "Try suggestion: Show me a chart of revenue over the last six months";

const ASSERT_TIMEOUT = 45_000;

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("page loads with custom composer and four suggestion pills", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="headless-composer"]'),
    ).toBeVisible();

    // Pills use aria-label `Try suggestion: ${prompt}` so screen readers can
    // disambiguate. We assert all four are mounted on first paint.
    await expect(
      page.getByRole("button", { name: PILL_WEATHER, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: PILL_STOCK, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: PILL_HIGHLIGHT, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: PILL_CHART, exact: true }),
    ).toBeVisible();
  });

  test("weather pill renders the headless WeatherCard via useRenderTool plus the deterministic narration", async ({
    page,
  }) => {
    await page.getByRole("button", { name: PILL_WEATHER, exact: true }).click();

    const card = page.locator('[data-testid="headless-weather-card"]').first();
    await expect(card).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(card).toContainText("Tokyo");
    await expect(card).toContainText("Sunny");
    await expect(card).toContainText("68°F");

    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText("Tokyo is 22°C and partly cloudy.", {
      timeout: ASSERT_TIMEOUT,
    });
  });

  test("AAPL pill renders the headless StockCard via useRenderTool plus the deterministic narration", async ({
    page,
  }) => {
    await page.getByRole("button", { name: PILL_STOCK, exact: true }).click();

    const card = page.locator('[data-testid="headless-stock-card"]').first();
    await expect(card).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(card).toContainText("AAPL");
    await expect(card).toContainText("$189.42");
    await expect(card).toContainText("+1.27%");

    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText(
      "AAPL is trading at $189.42, up 1.27% on the day",
      { timeout: ASSERT_TIMEOUT },
    );
  });

  test("highlight pill renders the headless HighlightNote via useComponent plus the deterministic narration", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: PILL_HIGHLIGHT, exact: true })
      .click();

    // The highlight card is the frontend-tool render surface (useComponent).
    const card = page
      .locator('[data-testid="headless-highlight-card"]')
      .first();
    await expect(card).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(card).toContainText("ship the demo on Friday");

    // Narration leading phrase comes from the new high-priority fixture in
    // d5-all.json; the showcase-assistant catch-all in feature-parity.json
    // would otherwise win and reply with "Hi there! I'm your showcase
    // assistant…".
    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText("ship the demo on Friday", {
      timeout: ASSERT_TIMEOUT,
    });
  });

  test("revenue chart pill renders the headless ChartCard via useRenderTool plus the deterministic narration", async ({
    page,
  }) => {
    await page.getByRole("button", { name: PILL_CHART, exact: true }).click();

    const card = page.locator('[data-testid="headless-revenue-chart"]').first();
    await expect(card).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(card).toContainText("Quarterly revenue");
    await expect(card).toContainText("Last six months · USD thousands");

    // Month labels come from the python tool's deterministic mock series
    // (Jan…Jun); recharts renders them as <text> tick labels inside the SVG.
    for (const month of ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]) {
      await expect(card).toContainText(month);
    }

    const assistant = page
      .locator('[data-testid="headless-message-assistant"]')
      .first();
    await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
    await expect(assistant).toContainText(
      "Here is the chart of revenue over the last six months",
      { timeout: ASSERT_TIMEOUT },
    );
  });
});
