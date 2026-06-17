import { test, expect } from "@playwright/test";

// QA reference: qa/tool-rendering-reasoning-chain.md
// Demo source: src/app/demos/tool-rendering-reasoning-chain/page.tsx
//
// The reasoning-chain cell composes two patterns into one chat surface:
//   - Reasoning-summary streaming (OpenAI Responses API, `reasoning={
//     "effort":"medium","summary":"detailed"}`) rendered through a
//     `messageView.reasoningMessage` slot (<ReasoningBlock>).
//   - Per-tool renderers wired via `useRenderTool` for `get_weather` and
//     `search_flights`, plus a `useDefaultRenderTool` catchall that
//     paints `get_stock_price` and `roll_dice`.
//
// Every pill drives a CHAINED two-tool flow:
//   - Stocks: get_stock_price(AAPL) → get_stock_price(MSFT) → comparison.
//   - Dice: roll_dice(sides=20) → roll_dice(sides=6) → contrast.
//   - Flights+weather: search_flights(SFO,JFK) → get_weather(JFK) → plan.
//
// Aimock fixtures live in showcase/aimock/d5-all.json (and the matching
// harness source at showcase/harness/fixtures/d5/tool-rendering-
// reasoning-chain.json) and pin every pill to a deterministic two-leg
// chain. The sequential-pills test is the regression guard for the
// AG-UI reasoning-role message bug in @copilotkit/runtime — without
// `LangGraphAgent.run`'s reasoning-role filter, clicking a second pill
// in the same thread used to crash with INCOMPLETE_STREAM because
// @ag-ui/langgraph's message converter throws on `role:"reasoning"`.

const SUGGESTION_TIMEOUT = 15_000;
const TOOL_TIMEOUT = 60_000;
const REASONING_TIMEOUT = 30_000;

const PILLS = [
  "Compare two stocks",
  "Chain of dice rolls",
  "Flights + destination weather",
] as const;

test.describe("Tool Rendering — Reasoning Chain", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-reasoning-chain");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: SUGGESTION_TIMEOUT,
    });
  });

  test("page loads with composer and 3 suggestion pills", async ({ page }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    for (const title of PILLS) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: SUGGESTION_TIMEOUT,
      });
    }

    // Sanity: no per-tool cards mounted before any pill click.
    await expect(page.locator('[data-testid="weather-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="flight-list-card"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid="custom-catchall-card"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-testid="reasoning-block"]')).toHaveCount(
      0,
    );
  });

  test("Compare two stocks pill chains AAPL → MSFT through the catchall renderer", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Compare two stocks" })
      .first()
      .click();

    // Both legs of the chain mount via the catchall renderer — scoped
    // by `data-tool-name` so we'd notice if a future per-tool stock
    // renderer landed and only one card rendered.
    const stockCards = page.locator(
      '[data-testid="custom-catchall-card"][data-tool-name="get_stock_price"]',
    );
    await expect
      .poll(async () => stockCards.count(), { timeout: TOOL_TIMEOUT })
      .toBe(2);

    // Reasoning slot mounts at least once — proves the agent's
    // reasoning summaries reached the messageView slot, which is the
    // whole reason this cell exists vs the plain tool-rendering demo.
    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: REASONING_TIMEOUT });

    // Narration text comes from the fixture final-content leg.
    await expect(page.getByText("AAPL is at")).toBeVisible({
      timeout: TOOL_TIMEOUT,
    });
    await expect(page.getByText("MSFT is at")).toBeVisible({
      timeout: TOOL_TIMEOUT,
    });
  });

  test("Chain of dice rolls pill chains d20 → d6 through the catchall renderer", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Chain of dice rolls" })
      .first()
      .click();

    const diceCards = page.locator(
      '[data-testid="custom-catchall-card"][data-tool-name="roll_dice"]',
    );
    await expect
      .poll(async () => diceCards.count(), { timeout: TOOL_TIMEOUT })
      .toBe(2);

    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: REASONING_TIMEOUT });

    // Final narration mentions both dice + the contrast framing.
    await expect(page.getByText(/d20 came up/i)).toBeVisible({
      timeout: TOOL_TIMEOUT,
    });
  });

  test("Flights + destination weather pill chains search_flights → get_weather through branded per-tool renderers", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Flights + destination weather" })
      .first()
      .click();

    // Flights card uses its branded renderer (not the catchall).
    const flights = page.locator('[data-testid="flight-list-card"]').first();
    await expect(flights).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      flights.locator('[data-testid="flight-origin"]'),
    ).toContainText("SFO", { timeout: TOOL_TIMEOUT });
    await expect(
      flights.locator('[data-testid="flight-destination"]'),
    ).toContainText("JFK", { timeout: TOOL_TIMEOUT });

    // Destination weather card uses its branded renderer.
    const weather = page.locator('[data-testid="weather-card"]').first();
    await expect(weather).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(weather.locator('[data-testid="weather-city"]')).toContainText(
      "JFK",
      { timeout: TOOL_TIMEOUT },
    );

    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: REASONING_TIMEOUT });

    // Catchall renderer must NOT mount for these tools — both have
    // per-tool registrations.
    await expect(
      page.locator('[data-testid="custom-catchall-card"]'),
    ).toHaveCount(0);
  });

  // REGRESSION for the AG-UI reasoning-role message bug:
  //   `@ag-ui/langgraph`'s message converter throws "message role is
  //   not supported." on any role outside {user,assistant,system,tool}.
  //   Reasoning-stream agents emit `role:"reasoning"` messages that the
  //   AG-UI client replays on subsequent turns. Without the
  //   reasoning-role filter in @copilotkit/runtime's LangGraphAgent.run
  //   subclass, the SECOND pill click crashes before the model is
  //   called and the user sees a runtime error toast.
  //
  // This test clicks all three pills sequentially in ONE thread and
  // asserts the full chain renders for each — proving cross-turn safety.
  // It also catches a regression in any of:
  //   - The fixture toolCallId chains (degrading multi-pill to single
  //     tool calls).
  //   - The reasoning summary emission on follow-up turns.
  //   - Per-tool renderer state isolation between turns.
  test("sequential pills in one thread render full chains + reasoning blocks for each", async ({
    page,
  }) => {
    // Three sequential pills × 2-tool chains × LLM-mock latency easily
    // exceeds Playwright's 30s default. Match the budget the
    // tool-rendering-default-catchall multi-pill regression uses.
    test.setTimeout(240_000);

    const reasoningBlocks = page.locator('[data-testid="reasoning-block"]');

    // Pill 1 — stocks chain.
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Compare two stocks" })
      .first()
      .click();
    const stockCards = page.locator(
      '[data-testid="custom-catchall-card"][data-tool-name="get_stock_price"]',
    );
    await expect
      .poll(async () => stockCards.count(), { timeout: TOOL_TIMEOUT })
      .toBe(2);
    await expect
      .poll(async () => reasoningBlocks.count(), { timeout: REASONING_TIMEOUT })
      .toBeGreaterThanOrEqual(1);

    // Pill 2 — dice chain. The KEY assertion: this used to crash with
    // INCOMPLETE_STREAM before the reasoning-role filter landed.
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Chain of dice rolls" })
      .first()
      .click();
    const diceCards = page.locator(
      '[data-testid="custom-catchall-card"][data-tool-name="roll_dice"]',
    );
    await expect
      .poll(async () => diceCards.count(), { timeout: TOOL_TIMEOUT })
      .toBe(2);
    // Reasoning blocks should have INCREASED — proves the second turn
    // produced fresh reasoning, not just reusing turn 1's block.
    await expect
      .poll(async () => reasoningBlocks.count(), { timeout: REASONING_TIMEOUT })
      .toBeGreaterThanOrEqual(2);

    // Pill 3 — flights + destination weather. Final regression hop.
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Flights + destination weather" })
      .first()
      .click();
    await expect(
      page.locator('[data-testid="flight-list-card"]').first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      page.locator('[data-testid="weather-card"]').first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect
      .poll(async () => reasoningBlocks.count(), { timeout: REASONING_TIMEOUT })
      .toBeGreaterThanOrEqual(3);

    // Final sanity: card counts for the prior turns survived (no
    // unmounts mid-thread).
    await expect(stockCards).toHaveCount(2);
    await expect(diceCards).toHaveCount(2);
  });
});
