import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/tool-rendering-reasoning-chain/page.tsx
//
// The demo composes two patterns in one chat:
//   - Reasoning summaries, rendered through a `messageView.reasoningMessage`
//     slot (<ReasoningBlock>).
//   - Per-tool renderers (`useRenderTool`) for `get_weather` and
//     `search_flights`, plus a `useDefaultRenderTool` catch-all that paints
//     `get_stock_price` and `roll_dice`.
//
// Every pill drives a CHAINED two-tool flow:
//   - Stocks: get_stock_price(AAPL), then get_stock_price(MSFT), then a
//     comparison.
//   - Dice: roll_dice(sides=20), then roll_dice(sides=6), then a contrast.
//   - Flights and weather: search_flights(SFO, JFK), then get_weather(JFK),
//     then a plan.
//
// The aimock fixtures pin every pill to a deterministic two-step chain. The
// sequential-pills test guards against the AG-UI reasoning-role bug: a
// second pill in the same thread used to crash with INCOMPLETE_STREAM,
// because a message converter threw on `role: "reasoning"` messages.

const SUGGESTION_TIMEOUT = 15_000;
const TOOL_TIMEOUT = 60_000;
const REASONING_TIMEOUT = 30_000;

const PILLS = [
  "Compare two stocks",
  "Chain of dice rolls",
  "Flights + destination weather",
] as const;

async function clickSuggestion(page: Page, title: (typeof PILLS)[number]) {
  await page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first()
    .click();
}

// The catch-all cards of one tool. Scoping by `data-tool-name` means a
// future per-tool renderer for that tool would show up as a missing card.
function catchallCards(page: Page, toolName: string) {
  return page.locator(
    `[data-testid="custom-catchall-card"][data-tool-name="${toolName}"]`,
  );
}

function reasoningBlocks(page: Page) {
  return page.locator('[data-testid="reasoning-block"]');
}

describeDemo(
  "tool-rendering-reasoning-chain",
  "Tool Rendering: Reasoning Chain",
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(demoPath("tool-rendering-reasoning-chain"));
      await expect(page.getByPlaceholder("Type a message")).toBeVisible({
        timeout: SUGGESTION_TIMEOUT,
      });
    });

    test("page loads with composer and 3 suggestion pills", async ({
      page,
    }) => {
      const suggestions = page.locator('[data-testid="copilot-suggestion"]');
      for (const title of PILLS) {
        await expect(
          suggestions.filter({ hasText: title }).first(),
        ).toBeVisible({ timeout: SUGGESTION_TIMEOUT });
      }

      // No card and no reasoning block before any pill is clicked.
      for (const testId of [
        "weather-card",
        "flight-list-card",
        "custom-catchall-card",
        "reasoning-block",
      ]) {
        await expect(page.locator(`[data-testid="${testId}"]`)).toHaveCount(0);
      }
    });

    test("Compare two stocks pill chains AAPL then MSFT through the catch-all renderer", async ({
      page,
    }) => {
      await clickSuggestion(page, "Compare two stocks");

      await expect
        .poll(async () => catchallCards(page, "get_stock_price").count(), {
          timeout: TOOL_TIMEOUT,
        })
        .toBe(2);

      // The reasoning slot mounts at least once: the agent's reasoning
      // summaries reached the messageView slot, which is the point of this
      // demo.
      await expect(reasoningBlocks(page).first()).toBeVisible({
        timeout: REASONING_TIMEOUT,
      });

      // The narration comes from the fixture's final answer.
      await expect(page.getByText("AAPL is at")).toBeVisible({
        timeout: TOOL_TIMEOUT,
      });
      await expect(page.getByText("MSFT is at")).toBeVisible({
        timeout: TOOL_TIMEOUT,
      });
    });

    test("Chain of dice rolls pill chains d20 then d6 through the catch-all renderer", async ({
      page,
    }) => {
      await clickSuggestion(page, "Chain of dice rolls");

      await expect
        .poll(async () => catchallCards(page, "roll_dice").count(), {
          timeout: TOOL_TIMEOUT,
        })
        .toBe(2);

      await expect(reasoningBlocks(page).first()).toBeVisible({
        timeout: REASONING_TIMEOUT,
      });

      // The final narration mentions both dice and contrasts them.
      await expect(page.getByText(/d20 came up/i)).toBeVisible({
        timeout: TOOL_TIMEOUT,
      });
    });

    test("Flights + destination weather pill chains search_flights then get_weather through branded per-tool renderers", async ({
      page,
    }) => {
      await clickSuggestion(page, "Flights + destination weather");

      // The flights card uses its branded renderer, not the catch-all.
      const flights = page.locator('[data-testid="flight-list-card"]').first();
      await expect(flights).toBeVisible({ timeout: TOOL_TIMEOUT });
      await expect(
        flights.locator('[data-testid="flight-origin"]'),
      ).toContainText("SFO", { timeout: TOOL_TIMEOUT });
      await expect(
        flights.locator('[data-testid="flight-destination"]'),
      ).toContainText("JFK", { timeout: TOOL_TIMEOUT });

      // The destination weather card uses its branded renderer too.
      const weather = page.locator('[data-testid="weather-card"]').first();
      await expect(weather).toBeVisible({ timeout: TOOL_TIMEOUT });
      await expect(
        weather.locator('[data-testid="weather-city"]'),
      ).toContainText("JFK", { timeout: TOOL_TIMEOUT });

      await expect(reasoningBlocks(page).first()).toBeVisible({
        timeout: REASONING_TIMEOUT,
      });

      // Both tools have per-tool renderers, so the catch-all never mounts.
      await expect(
        page.locator('[data-testid="custom-catchall-card"]'),
      ).toHaveCount(0);
    });

    // Regression for the AG-UI reasoning-role message bug: reasoning agents
    // emit `role: "reasoning"` messages, and the client sends them back on
    // the next turn. A message converter that throws on that role crashed
    // the SECOND pill before the model was called.
    //
    // This test clicks all three pills in ONE thread and expects the full
    // chain for each. It also catches regressions in the fixtures' toolCallId
    // chains, in reasoning on follow-up turns, and in per-tool renderer state
    // between turns.
    test("sequential pills in one thread render full chains + reasoning blocks for each", async ({
      page,
    }) => {
      // Three pills, each a two-tool chain, take longer than Playwright's
      // 30s default.
      test.setTimeout(240_000);

      const stockCards = catchallCards(page, "get_stock_price");
      const diceCards = catchallCards(page, "roll_dice");

      // Pill 1: the stocks chain.
      await clickSuggestion(page, "Compare two stocks");
      await expect
        .poll(async () => stockCards.count(), { timeout: TOOL_TIMEOUT })
        .toBe(2);
      await expect
        .poll(async () => reasoningBlocks(page).count(), {
          timeout: REASONING_TIMEOUT,
        })
        .toBeGreaterThanOrEqual(1);

      // Pill 2: the dice chain. This is the pill that used to crash.
      await clickSuggestion(page, "Chain of dice rolls");
      await expect
        .poll(async () => diceCards.count(), { timeout: TOOL_TIMEOUT })
        .toBe(2);
      // More reasoning blocks than before: the second turn produced fresh
      // reasoning instead of reusing the first turn's block.
      await expect
        .poll(async () => reasoningBlocks(page).count(), {
          timeout: REASONING_TIMEOUT,
        })
        .toBeGreaterThanOrEqual(2);

      // Pill 3: flights and destination weather.
      await clickSuggestion(page, "Flights + destination weather");
      await expect(
        page.locator('[data-testid="flight-list-card"]').first(),
      ).toBeVisible({ timeout: TOOL_TIMEOUT });
      await expect(
        page.locator('[data-testid="weather-card"]').first(),
      ).toBeVisible({ timeout: TOOL_TIMEOUT });
      await expect
        .poll(async () => reasoningBlocks(page).count(), {
          timeout: REASONING_TIMEOUT,
        })
        .toBeGreaterThanOrEqual(3);

      // The earlier turns' cards are still there: nothing unmounted
      // mid-thread.
      await expect(stockCards).toHaveCount(2);
      await expect(diceCards).toHaveCount(2);
    });
  },
);
