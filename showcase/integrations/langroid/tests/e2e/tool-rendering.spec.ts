import { test, expect } from "@playwright/test";

// QA reference: qa/tool-rendering.md
// Demo source: src/app/demos/tool-rendering/page.tsx
//
// Pill-driven 6-test plan. The cell registers a per-tool useRenderTool
// for every "interesting" tool (get_weather, search_flights,
// get_stock_price, roll_d20) plus a wildcard catch-all. Each pill
// drives the corresponding tool path and asserts on the per-tool
// branded card's stable testid plus deterministic fixture values.
//
// Aimock fixtures live in showcase/aimock/d5-all.json and pin every
// pill prompt to a deterministic tool-call sequence.

const SUGGESTION_TIMEOUT = 15000;
const TOOL_TIMEOUT = 60000;

test.describe("Tool Rendering", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering");
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
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Weather in SF" })
      .first()
      .click();

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
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Find flights" })
      .first()
      .click();

    const card = page.locator('[data-testid="flights-card"]').first();
    await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(card.locator('[data-testid="flight-origin"]')).toContainText(
      "SFO",
      { timeout: TOOL_TIMEOUT },
    );
    await expect(
      card.locator('[data-testid="flight-destination"]'),
    ).toContainText("JFK", { timeout: TOOL_TIMEOUT });

    // At least 2 flight rows from the deterministic fixture (NOT the
    // a2ui beautiful-chat boilerplate — a2ui shows a different shell).
    const rows = card.locator('[data-testid="flight-row"]');
    await expect
      .poll(async () => rows.count(), { timeout: TOOL_TIMEOUT })
      .toBeGreaterThanOrEqual(2);
  });

  test("Stock price pill renders the AAPL stock card", async ({ page }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Stock price" })
      .first()
      .click();

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
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Roll a d20" })
      .first()
      .click();

    const cards = page.locator('[data-testid="d20-card"]');

    // Wait for all 5 sequential rolls to land.
    await expect
      .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
      .toBe(5);

    // Final roll is a 20.
    await expect(cards.nth(4).locator('[data-testid="d20-value"]')).toHaveText(
      "20",
      { timeout: TOOL_TIMEOUT },
    );

    // First 4 rolls are non-20.
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
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Chain tools" })
      .first()
      .click();

    await expect(
      page.locator('[data-testid="weather-card"]').first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      page.locator('[data-testid="flights-card"]').first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(page.locator('[data-testid="d20-card"]').first()).toBeVisible({
      timeout: TOOL_TIMEOUT,
    });
  });
});
