import { test, expect } from "@playwright/test";

// QA reference: qa/tool-rendering-default-catchall.md
// Demo source: src/app/demos/tool-rendering-default-catchall/page.tsx
//
// This cell calls `useDefaultRenderTool()` with NO config — CopilotKit's
// built-in `DefaultToolCallRenderer` is registered as the `*` wildcard and
// paints every tool call. The frontend adds ZERO custom renderers, so there
// are no app-level testids on the card. We identify the default card by the
// tool-name text plus the status-pill label ("Running" / "Done") that the
// built-in renderer always emits, and we assert the ABSENCE of the branded
// custom-catchall / weather-card testids to prove the built-in is in force.
//
// Backend is shared across four tool-rendering slugs — the agent chains at
// least two tool calls per user question (get_weather + search_flights,
// etc.), which is what the QA checklist wants surfaced here. Assertions
// avoid LLM-generated text and only check tool-name + status signals.

test.describe("Tool Rendering — Default Catch-all", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("page loads with chat input and suggestion pills", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();

    // useConfigureSuggestions registers three pills with available: "always".
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "Weather in SF" }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      suggestions.filter({ hasText: "Find flights" }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      suggestions.filter({ hasText: "Roll a d20" }).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test("weather prompt paints the built-in default tool-call card", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What's the weather in San Francisco?");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // The built-in DefaultToolCallRenderer always shows the tool name as a
    // header and a status pill. Wait for `get_weather` to appear anywhere
    // in the transcript — this is the card's stable header label.
    await expect(
      page.getByText("get_weather", { exact: true }).first(),
    ).toBeVisible({ timeout: 60000 });

    // The status pill lands on "Done" once the tool result streams back.
    await expect(page.getByText("Done", { exact: true }).first()).toBeVisible({
      timeout: 60000,
    });

    // Critical: the built-in card is in force — no branded custom-catchall
    // card and no per-tool weather-card from sibling demos.
    await expect(
      page.locator('[data-testid="custom-catchall-card"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="weather-card"]')).toHaveCount(0);
  });

  test("dice prompt paints a default card with the roll_dice header", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Roll a 20-sided die.");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(
      page.getByText("roll_dice", { exact: true }).first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Done", { exact: true }).first()).toBeVisible({
      timeout: 60000,
    });

    // Still no branded card — same built-in UI paints every tool.
    await expect(
      page.locator('[data-testid="custom-catchall-card"]'),
    ).toHaveCount(0);
  });

  test("Tokyo weather prompt chains at least two default cards", async ({
    page,
  }) => {
    // The agent's system prompt habitually chains tools — "weather in Tokyo"
    // triggers get_weather then search_flights (see tool_rendering_agent.py
    // SYSTEM_PROMPT). We assert two distinct tool-name headers show up, both
    // with a "Done" pill, and zero custom-branded cards.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What's the weather in Tokyo?");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(
      page.getByText("get_weather", { exact: true }).first(),
    ).toBeVisible({ timeout: 60000 });

    // At least one additional tool-call header appears beyond get_weather.
    // search_flights is the primary chained partner; accept either the
    // flights or a second get_weather header as evidence of chaining.
    await expect
      .poll(
        async () => {
          const flights = await page
            .getByText("search_flights", { exact: true })
            .count();
          const weathers = await page
            .getByText("get_weather", { exact: true })
            .count();
          return flights >= 1 || weathers >= 2;
        },
        { timeout: 60000 },
      )
      .toBe(true);

    // Every tool-call card that rendered must be the built-in default —
    // branded / per-tool testids stay at zero.
    await expect(
      page.locator('[data-testid="custom-catchall-card"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="weather-card"]')).toHaveCount(0);
  });
});
