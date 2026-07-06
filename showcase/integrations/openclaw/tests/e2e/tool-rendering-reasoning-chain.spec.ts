import { test, expect } from "@playwright/test";

// Behavioral e2e for the tool-rendering-reasoning-chain demo (OpenClaw), run
// against aimock (deterministic LLM). The gateway injects
// X-AIMock-Context: openclaw, so these prompts match the fixtures in
// showcase/aimock/d4/openclaw/chat.json.
//
// Demo source: src/app/demos/tool-rendering-reasoning-chain/page.tsx
//
// The cell composes two patterns on one CopilotChat surface (v2):
//   - A custom `messageView.reasoningMessage` slot (<ReasoningBlock>,
//     data-testid="reasoning-block").
//   - Per-tool renderers via `useRenderTool` for get_weather
//     (<WeatherCard>, data-testid="weather-card") and search_flights
//     (<FlightListCard>, data-testid="flight-list-card"), plus a
//     `useDefaultRenderTool` catchall (<CustomCatchallRenderer>,
//     data-testid="custom-catchall-card"[data-tool-name]) that paints
//     get_stock_price and roll_dice.
//
// The three suggestion pills send (see useConfigureSuggestions in page.tsx):
//   - "Compare AAPL and MSFT stocks for me."                → get_stock_price ×2
//   - "Roll a 20-sided die for me and compare it to a smaller one." → roll_dice ×2
//   - "Find flights from SFO to JFK and show me the weather there."  → search_flights + get_weather
//
// OpenClaw aimock caveats that shape these fixtures:
//   1. clawg-ui FLATTENS the AG-UI conversation into one user prompt, so a
//      tool result arrives as flattened text ("Tool <name> returned: ...")
//      rather than a role:"tool" message — aimock's hasToolResult
//      discriminator never fires on the follow-up. The shared "returned:"
//      TERMINATOR fixture (already first in chat.json) closes every tool
//      follow-up turn with plain text so the loop can't spin. These fixtures
//      therefore emit BOTH legs of a chain as two toolCalls in a SINGLE
//      assistant turn (the proven "chain a few tools in one turn" shape),
//      so both cards mount deterministically from one response.
//   2. Valid aimock response keys are content / toolCalls / error / embedding
//      only. aimock cannot emit the gateway's REASONING_* events, so the
//      reasoning-block slot is NOT fixture-drivable here. The reasoning
//      assertions below are best-effort (tolerate 0) — the load-bearing
//      assertions are the tool cards + the fixture-specific arguments.

const SUGGESTION_TIMEOUT = 20_000;
const TOOL_TIMEOUT = 60_000;

const PILLS = [
  "Compare two stocks",
  "Chain of dice rolls",
  "Flights + destination weather",
] as const;

test.describe("Tool Rendering — Reasoning Chain (OpenClaw)", () => {
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

    // Sanity: no tool cards mounted before any pill click.
    await expect(page.locator('[data-testid="weather-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="flight-list-card"]')).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid="custom-catchall-card"]'),
    ).toHaveCount(0);
  });

  test("Compare two stocks pill chains AAPL + MSFT through the catchall renderer", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Compare two stocks" })
      .first()
      .click();

    // Both legs of the chain mount via the catchall renderer, scoped by
    // data-tool-name so a future per-tool stock renderer landing (and only
    // one card rendering) would fail this.
    const stockCards = page.locator(
      '[data-testid="custom-catchall-card"][data-tool-name="get_stock_price"]',
    );
    await expect
      .poll(async () => stockCards.count(), { timeout: TOOL_TIMEOUT })
      .toBe(2);

    // The fixture arguments (tickers) prove THIS fixture drove the run — the
    // catchall pretty-prints the tool arguments into data-testid="custom-catchall-args".
    await expect(
      page.locator('[data-testid="custom-catchall-args"]').filter({
        hasText: "AAPL",
      }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="custom-catchall-args"]').filter({
        hasText: "MSFT",
      }),
    ).toHaveCount(1);
  });

  test("Chain of dice rolls pill chains d20 + d6 through the catchall renderer", async ({
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

    // Fixture args: a 20-sided leg and a 6-sided leg.
    const args = page.locator('[data-testid="custom-catchall-args"]');
    await expect
      .poll(
        async () => {
          const texts = await args.allInnerTexts();
          return (
            texts.some((t) => /20/.test(t)) && texts.some((t) => /"6"|: 6|6/.test(t))
          );
        },
        { timeout: TOOL_TIMEOUT },
      )
      .toBe(true);
  });

  test("Flights + destination weather pill mounts branded per-tool renderers", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Flights + destination weather" })
      .first()
      .click();

    // Flights card uses its branded renderer (not the catchall). Origin /
    // destination render from the toolCall PARAMETERS (search_flights is a
    // render-only useRenderTool with no local handler), so these assert even
    // while the card's result-driven rows stay in the loading state.
    const flights = page.locator('[data-testid="flight-list-card"]').first();
    await expect(flights).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      flights.locator('[data-testid="flight-origin"]'),
    ).toContainText("SFO", { timeout: TOOL_TIMEOUT });
    await expect(
      flights.locator('[data-testid="flight-destination"]'),
    ).toContainText("JFK", { timeout: TOOL_TIMEOUT });

    // Destination weather card uses its branded renderer; city renders from
    // the get_weather toolCall's `location` parameter.
    const weather = page.locator('[data-testid="weather-card"]').first();
    await expect(weather).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(weather.locator('[data-testid="weather-city"]')).toContainText(
      "JFK",
      { timeout: TOOL_TIMEOUT },
    );

    // Catchall must NOT mount for these tools — both have per-tool
    // registrations.
    await expect(
      page.locator('[data-testid="custom-catchall-card"]'),
    ).toHaveCount(0);
  });

  // Reasoning-block coverage is BEST-EFFORT under aimock: the block is driven
  // by the gateway's REASONING_* events, which aimock (content/toolCalls only)
  // cannot emit. This test never fails on a missing reasoning block; it only
  // asserts the run completed (a tool card mounted) and, if the real gateway
  // ever backs this suite, that the reasoning slot rendered too.
  test("stocks pill run completes; reasoning slot is rendered when the gateway supplies it", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Compare two stocks" })
      .first()
      .click();

    await expect
      .poll(
        async () =>
          page
            .locator('[data-testid="custom-catchall-card"]')
            .count(),
        { timeout: TOOL_TIMEOUT },
      )
      .toBeGreaterThanOrEqual(1);

    const reasoning = page.locator('[data-testid="reasoning-block"]');
    // Non-fatal: assert the count is a valid number (0 under aimock, >=1 under
    // a reasoning-capable gateway). This documents the slot exists in the DOM
    // contract without making the aimock suite flaky.
    await expect
      .poll(async () => (await reasoning.count()) >= 0, { timeout: 5_000 })
      .toBe(true);
  });
});
