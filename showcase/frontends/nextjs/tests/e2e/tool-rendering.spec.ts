import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/tool-rendering/page.tsx
//
// The demo registers a per-tool `useRenderTool` for every "interesting" tool
// (get_weather, search_flights, get_stock_price, roll_d20) plus a wildcard
// catch-all. Each pill drives one tool path, and each test checks the
// branded card's stable testids and the values the aimock fixtures script.

const SUGGESTION_TIMEOUT = 15000;
const TOOL_TIMEOUT = 60000;

async function clickSuggestion(page: Page, title: string) {
  await page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first()
    .click();
}

describeDemo("tool-rendering", "Tool Rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("tool-rendering"));
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: SUGGESTION_TIMEOUT,
    });
  });

  test("page loads with composer and 5 suggestion pills", async ({ page }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    for (const title of [
      "Weather in SF",
      "Find flights",
      "Stock price",
      "Roll a d20",
      "Chain tools",
    ]) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: SUGGESTION_TIMEOUT,
      });
    }
  });

  test("Weather in SF pill renders the SF weather card", async ({ page }) => {
    await clickSuggestion(page, "Weather in SF");

    const card = page.locator('[data-testid="weather-card"]').first();
    await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(card.locator('[data-testid="weather-city"]')).toContainText(
      "San Francisco",
      { timeout: TOOL_TIMEOUT },
    );
    await expect(
      card.locator('[data-testid="weather-humidity"]'),
    ).toContainText("55%", { timeout: TOOL_TIMEOUT });
    await expect(card.locator('[data-testid="weather-wind"]')).toContainText(
      "10",
      { timeout: TOOL_TIMEOUT },
    );
  });

  test("Find flights pill renders the flights card with deterministic flights", async ({
    page,
  }) => {
    await clickSuggestion(page, "Find flights");

    const card = page.locator('[data-testid="flights-card"]').first();
    await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(card.locator('[data-testid="flight-origin"]')).toContainText(
      "SFO",
      { timeout: TOOL_TIMEOUT },
    );
    await expect(
      card.locator('[data-testid="flight-destination"]'),
    ).toContainText("JFK", { timeout: TOOL_TIMEOUT });

    // At least 2 flight rows from the deterministic fixture (not the A2UI
    // flight cards of beautiful-chat, which have a different shell).
    const rows = card.locator('[data-testid="flight-row"]');
    await expect
      .poll(async () => rows.count(), { timeout: TOOL_TIMEOUT })
      .toBeGreaterThanOrEqual(2);

    // Each row shows the tool result's airline, times and price. A result
    // whose keys the card does not read shows the "? → ?" placeholder.
    const firstRow = rows.first();
    await expect(firstRow).toContainText("United", { timeout: TOOL_TIMEOUT });
    await expect(firstRow).toContainText("08:15", { timeout: TOOL_TIMEOUT });
    await expect(firstRow).toContainText("16:45", { timeout: TOOL_TIMEOUT });
    await expect(firstRow).toContainText("$348", { timeout: TOOL_TIMEOUT });
    await expect(firstRow).not.toContainText("? → ?");
  });

  test("Stock price pill renders the AAPL stock card", async ({ page }) => {
    await clickSuggestion(page, "Stock price");

    const card = page.locator('[data-testid="stock-card"]').first();
    await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(card.locator('[data-testid="stock-ticker"]')).toHaveText(
      "AAPL",
      { timeout: TOOL_TIMEOUT },
    );
    await expect(card.locator('[data-testid="stock-price"]')).toContainText(
      "$338.37",
      { timeout: TOOL_TIMEOUT },
    );
    await expect(card.locator('[data-testid="stock-change"]')).toContainText(
      "-2.96%",
      { timeout: TOOL_TIMEOUT },
    );
  });

  test("Roll a d20 pill produces exactly 5 d20 cards, last result is 20", async ({
    page,
  }) => {
    await clickSuggestion(page, "Roll a d20");

    const cards = page.locator('[data-testid="d20-card"]');

    // Wait for all 5 sequential rolls to land.
    await expect
      .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
      .toBe(5);

    // The final roll is a 20.
    await expect(cards.nth(4).locator('[data-testid="d20-value"]')).toHaveText(
      "20",
      { timeout: TOOL_TIMEOUT },
    );

    // The first 4 rolls are not 20.
    for (let i = 0; i < 4; i++) {
      const value = await cards
        .nth(i)
        .locator('[data-testid="d20-value"]')
        .innerText();
      expect(value.trim()).not.toBe("20");
    }
  });

  test("Chain tools pill renders weather + flights + d20 cards in one turn", async ({
    page,
  }) => {
    await clickSuggestion(page, "Chain tools");

    for (const testId of ["weather-card", "flights-card", "d20-card"]) {
      await expect(
        page.locator(`[data-testid="${testId}"]`).first(),
      ).toBeVisible({ timeout: TOOL_TIMEOUT });
    }
  });
});
