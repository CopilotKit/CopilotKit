import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/tool-rendering-default-catchall/page.tsx
//
// This demo registers no custom renderer. `useDefaultRenderTool()` paints
// every tool call with CopilotKit's built-in renderer, which marks each call
// with `data-testid="copilot-tool-render"` and a `data-tool-name="<name>"`
// attribute. The tests assert on that built-in contract, and check that the
// branded cards of the sibling demos never appear here.

const SUGGESTION_TIMEOUT = 15000;
const TOOL_TIMEOUT = 60000;

const PILLS = ["Weather in SF", "Find flights", "Roll a d20", "Chain tools"];

// The scripted d20 roll that ends the five-roll sequence.
const ROLLED_TWENTY = /"value":\s*20|"result":\s*20/;

async function clickSuggestion(page: Page, title: string) {
  await page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first()
    .click();
}

// The built-in renderer's cards, optionally only those of one tool.
function defaultCards(page: Page, toolName?: string) {
  const toolFilter =
    toolName === undefined ? "" : `[data-tool-name="${toolName}"]`;
  return page.locator(`[data-testid="copilot-tool-render"]${toolFilter}`);
}

describeDemo(
  "tool-rendering-default-catchall",
  "Tool Rendering: Default Catch-all",
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(demoPath("tool-rendering-default-catchall"));
      await expect(page.getByPlaceholder("Type a message")).toBeVisible({
        timeout: SUGGESTION_TIMEOUT,
      });
    });

    test("page loads with composer and 4 suggestion pills", async ({
      page,
    }) => {
      const suggestions = page.locator('[data-testid="copilot-suggestion"]');
      for (const title of PILLS) {
        await expect(
          suggestions.filter({ hasText: title }).first(),
        ).toBeVisible({ timeout: SUGGESTION_TIMEOUT });
      }

      // The branded cards of the sibling demos stay at zero here.
      for (const testId of [
        "weather-card",
        "flights-card",
        "stock-card",
        "d20-card",
        "custom-wildcard-card",
      ]) {
        await expect(page.locator(`[data-testid="${testId}"]`)).toHaveCount(0);
      }
    });

    test("Weather in SF pill paints the built-in default card for get_weather", async ({
      page,
    }) => {
      await clickSuggestion(page, "Weather in SF");

      const card = defaultCards(page, "get_weather").first();
      await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });

      // The fixture pins the arguments to San Francisco.
      await expect
        .poll(async () => card.getAttribute("data-args"), {
          timeout: TOOL_TIMEOUT,
        })
        .toContain("San Francisco");

      await expect(page.locator('[data-testid="weather-card"]')).toHaveCount(0);
      await expect(
        page.locator('[data-testid="custom-wildcard-card"]'),
      ).toHaveCount(0);
    });

    test("Find flights pill paints the built-in default card for search_flights", async ({
      page,
    }) => {
      await clickSuggestion(page, "Find flights");

      const card = defaultCards(page, "search_flights").first();
      await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });

      // The result carries the fixture's flights, not the A2UI flight cards
      // of beautiful-chat.
      await expect
        .poll(async () => card.getAttribute("data-result"), {
          timeout: TOOL_TIMEOUT,
        })
        .toMatch(/United|Delta|JetBlue/);

      await expect(page.locator('[data-testid="flights-card"]')).toHaveCount(0);
    });

    test("Roll a d20 pill paints exactly 5 default cards for roll_d20", async ({
      page,
    }) => {
      await clickSuggestion(page, "Roll a d20");

      const cards = defaultCards(page, "roll_d20");
      await expect
        .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
        .toBe(5);

      // The 5th result is the scripted 20. The first 4 are not.
      const lastResult = await cards.nth(4).getAttribute("data-result");
      expect(lastResult ?? "").toMatch(ROLLED_TWENTY);
      for (let i = 0; i < 4; i++) {
        const result = (await cards.nth(i).getAttribute("data-result")) ?? "";
        expect(result).not.toMatch(ROLLED_TWENTY);
      }

      await expect(page.locator('[data-testid="d20-card"]')).toHaveCount(0);
    });

    test("Chain tools pill paints 3 default cards (weather + flights + d20)", async ({
      page,
    }) => {
      await clickSuggestion(page, "Chain tools");

      for (const toolName of ["get_weather", "search_flights", "roll_d20"]) {
        await expect(defaultCards(page, toolName).first()).toBeVisible({
          timeout: TOOL_TIMEOUT,
        });
      }
    });

    // Regression for the aimock multi-pill bug: the d20 and Chain tools
    // fixtures used `turnIndex` and `hasToolResult` gates, which count the
    // whole thread. After Find flights, the d20 loop started at its third
    // roll (3 cards instead of 5). The fixtures now chain follow-ups via
    // `toolCallId`. This test drives Find flights, then Roll a d20, in one
    // thread and expects the full card sequence for each.
    test("sequential pills in one thread render full card sequences for each", async ({
      page,
    }) => {
      test.setTimeout(240_000);

      await clickSuggestion(page, "Find flights");
      await expect(defaultCards(page, "search_flights")).toHaveCount(1, {
        timeout: TOOL_TIMEOUT,
      });

      await clickSuggestion(page, "Roll a d20");
      const d20 = defaultCards(page, "roll_d20");
      await expect
        .poll(async () => d20.count(), { timeout: TOOL_TIMEOUT })
        .toBe(5);
      // The final scripted roll is the 20, so the chain ran through all 5
      // fixtures.
      await expect
        .poll(async () => d20.nth(4).getAttribute("data-result"), {
          timeout: TOOL_TIMEOUT,
        })
        .toMatch(ROLLED_TWENTY);
      await expect(page.getByText("Rolled the d20 five times")).toBeVisible({
        timeout: TOOL_TIMEOUT,
      });
    });

    test("every rendered card matches the built-in default-renderer DOM signature", async ({
      page,
    }) => {
      // One pill, one card, so the assertions see exactly the DOM the
      // built-in renderer produces.
      await clickSuggestion(page, "Weather in SF");

      const card = defaultCards(page).first();
      await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });

      // The built-in renderer always shows the tool name and its status.
      await expect(
        card.locator('[data-testid="copilot-tool-render-name"]'),
      ).toBeVisible({ timeout: TOOL_TIMEOUT });
      await expect(
        card.locator('[data-testid="copilot-tool-render-status"]'),
      ).toBeVisible({ timeout: TOOL_TIMEOUT });

      // Every card has exactly one name and one status, so the built-in
      // shell painted every card (no per-tool shells).
      const total = await defaultCards(page).count();
      await expect(
        page.locator('[data-testid="copilot-tool-render-name"]'),
      ).toHaveCount(total);
      await expect(
        page.locator('[data-testid="copilot-tool-render-status"]'),
      ).toHaveCount(total);
    });
  },
);
