import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Headless Chat (Complete): the full headless surface in one demo. The
// hand-rolled chat shell wires every render hook CopilotKit exposes
// (useRenderTool, useDefaultRenderTool, useComponent, useRenderToolCall,
// useSuggestions, useAttachments) on top of shadcn primitives.
//
// The tests click the 4 empty-state pills and check:
//   - the render component of each tool (Weather / Stock / Highlight /
//     Chart) mounts on the headless surface (its own test id)
//   - the assistant narration arrives in the custom assistant bubble
//     (`[data-testid="headless-message-assistant"]`)
//
// Each pill exercises a DIFFERENT render-hook path. If one hook breaks,
// only its test fails. If the page falls back to the default
// <CopilotChat />, the headless test ids disappear and all 4 tool tests
// fail.

const ASSERT_TIMEOUT = 45_000;

// The pills have the aria-label `Try suggestion: ${prompt}`, so that screen
// readers can tell them apart.
const TOOL_PILLS = [
  {
    title:
      "weather pill renders the headless WeatherCard via useRenderTool plus the deterministic narration",
    pill: "Try suggestion: What's the weather in Tokyo?",
    card: "headless-weather-card",
    cardTexts: ["Tokyo", "Sunny", "68°F"],
    narration: "Tokyo is 22°C and partly cloudy.",
  },
  {
    title:
      "AAPL pill renders the headless StockCard via useRenderTool plus the deterministic narration",
    pill: "Try suggestion: What's AAPL trading at?",
    card: "headless-stock-card",
    cardTexts: ["AAPL", "$189.42", "+1.27%"],
    narration: "AAPL is trading at $189.42, up 1.27% on the day",
  },
  {
    // The highlight card is the render surface of a frontend tool
    // (useComponent). The narration comes from the fixture for this prompt.
    // Without that fixture, the catch-all fixture answers with the greeting
    // of the showcase assistant.
    title:
      "highlight pill renders the headless HighlightNote via useComponent plus the deterministic narration",
    pill: "Try suggestion: Highlight: ship the demo on Friday",
    card: "headless-highlight-card",
    cardTexts: ["ship the demo on Friday"],
    narration: "ship the demo on Friday",
  },
  {
    // The month labels come from the tool's deterministic mock series
    // (Jan to Jun). Recharts renders them as <text> tick labels in the SVG.
    title:
      "revenue chart pill renders the headless ChartCard via useRenderTool plus the deterministic narration",
    pill: "Try suggestion: Show me a chart of revenue over the last six months",
    card: "headless-revenue-chart",
    cardTexts: [
      "Quarterly revenue",
      "Last six months · USD thousands",
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
    ],
    narration: "Here is the chart of revenue over the last six months",
  },
];

describeDemo("headless-complete", "Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("headless-complete"));
  });

  test("page loads with custom composer and four suggestion pills", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="headless-composer"]'),
    ).toBeVisible();

    // All four pills mount on first paint.
    for (const { pill } of TOOL_PILLS) {
      await expect(
        page.getByRole("button", { name: pill, exact: true }),
      ).toBeVisible();
    }
  });

  for (const { title, pill, card, cardTexts, narration } of TOOL_PILLS) {
    test(title, async ({ page }) => {
      await page.getByRole("button", { name: pill, exact: true }).click();

      const toolCard = page.locator(`[data-testid="${card}"]`).first();
      await expect(toolCard).toBeVisible({ timeout: ASSERT_TIMEOUT });
      for (const text of cardTexts) {
        await expect(toolCard).toContainText(text);
      }

      const assistant = page
        .locator('[data-testid="headless-message-assistant"]')
        .last();
      await expect(assistant).toBeVisible({ timeout: ASSERT_TIMEOUT });
      await expect(assistant).toContainText(narration, {
        timeout: ASSERT_TIMEOUT,
      });
    });
  }
});
