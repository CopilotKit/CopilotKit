import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Demo source: src/app/demos/[integration]/tool-rendering-custom-catchall/page.tsx
// Renderer source: src/app/demos/[integration]/tool-rendering-custom-catchall/custom-catchall-renderer.tsx
//
// This demo registers a SINGLE branded wildcard renderer via
// `useDefaultRenderTool`. Every tool call must paint in the same
// `[data-testid="custom-wildcard-card"]` shell, with no per-tool cards. The
// "same wildcard testid signature" test is the load-bearing one: after a
// pill, every card on the page has the same shell.

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

// The wildcard cards, optionally only those of one tool.
function wildcardCards(page: Page, toolName?: string) {
  const toolFilter =
    toolName === undefined ? "" : `[data-tool-name="${toolName}"]`;
  return page.locator(`[data-testid="custom-wildcard-card"]${toolFilter}`);
}

describeDemo(
  "tool-rendering-custom-catchall",
  "Tool Rendering: Custom Catch-all (branded wildcard)",
  () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(demoPath("tool-rendering-custom-catchall"));
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

      // The per-tool cards of the sibling demos, and the built-in default
      // card, stay at zero here.
      for (const testId of [
        "weather-card",
        "flights-card",
        "stock-card",
        "d20-card",
        "copilot-tool-render",
      ]) {
        await expect(page.locator(`[data-testid="${testId}"]`)).toHaveCount(0);
      }
    });

    test("Weather in SF pill paints the branded wildcard card for get_weather", async ({
      page,
    }) => {
      await clickSuggestion(page, "Weather in SF");

      const card = wildcardCards(page, "get_weather").first();
      await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });
      await expect(
        card.locator('[data-testid="custom-wildcard-tool-name"]'),
      ).toHaveText("get_weather");
      await expect(
        card.locator('[data-testid="custom-wildcard-args"]'),
      ).toContainText("San Francisco", { timeout: TOOL_TIMEOUT });
    });

    test("Find flights pill paints the SAME branded wildcard card for search_flights", async ({
      page,
    }) => {
      await clickSuggestion(page, "Find flights");

      const card = wildcardCards(page, "search_flights").first();
      await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });
      await expect(
        card.locator('[data-testid="custom-wildcard-tool-name"]'),
      ).toHaveText("search_flights");

      // The result shows the fixture's flights, not the A2UI flight cards of
      // beautiful-chat.
      await expect(
        card.locator('[data-testid="custom-wildcard-result"]'),
      ).toContainText(/United|Delta|JetBlue/, { timeout: TOOL_TIMEOUT });
    });

    test("Roll a d20 pill paints exactly 5 wildcard cards, last result is 20", async ({
      page,
    }) => {
      await clickSuggestion(page, "Roll a d20");

      const cards = wildcardCards(page, "roll_d20");
      await expect
        .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
        .toBe(5);

      // The 5th result is the scripted 20. The first 4 are not.
      await expect(
        cards.nth(4).locator('[data-testid="custom-wildcard-result"]'),
      ).toContainText(ROLLED_TWENTY, { timeout: TOOL_TIMEOUT });
      for (let i = 0; i < 4; i++) {
        const text = await cards
          .nth(i)
          .locator('[data-testid="custom-wildcard-result"]')
          .innerText();
        expect(text).not.toMatch(ROLLED_TWENTY);
      }
    });

    test("Chain tools pill paints 3 wildcard cards (one per tool)", async ({
      page,
    }) => {
      await clickSuggestion(page, "Chain tools");

      for (const toolName of ["get_weather", "search_flights", "roll_d20"]) {
        await expect(wildcardCards(page, toolName).first()).toBeVisible({
          timeout: TOOL_TIMEOUT,
        });
      }
    });

    test("every rendered card shares the same wildcard testid signature", async ({
      page,
    }) => {
      // Chain tools calls 3 distinct tools, so it paints 3 cards that must
      // all use the same wildcard shell.
      await clickSuggestion(page, "Chain tools");

      const cards = wildcardCards(page);
      await expect
        .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
        .toBeGreaterThanOrEqual(3);

      const total = await cards.count();
      await expect(
        page.locator('[data-testid="custom-wildcard-tool-name"]'),
      ).toHaveCount(total);
      await expect(
        page.locator('[data-testid="custom-wildcard-args"]'),
      ).toHaveCount(total);

      // The cards name different tools but share one shell.
      const toolNames = await cards.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-tool-name")),
      );
      expect(new Set(toolNames).size).toBeGreaterThanOrEqual(3);
      for (const name of toolNames) {
        expect(["get_weather", "search_flights", "roll_d20"]).toContain(name);
      }

      // The built-in default card stays at zero, so the single custom
      // wildcard painted every card, not the framework fallback.
      await expect(
        page.locator('[data-testid="copilot-tool-render"]'),
      ).toHaveCount(0);
    });

    // Regression for the aimock multi-pill bug: the d20 and Chain tools
    // fixtures used `turnIndex` and `hasToolResult` gates, which count the
    // whole thread. After Find flights, the d20 loop started at its third
    // roll (3 cards instead of 5), and the Chain tools fixture that calls the
    // tools was skipped, so only its final answer showed. The fixtures now
    // chain follow-ups via `toolCallId`. This test drives Find flights, Roll
    // a d20 and Chain tools in one thread and expects 1 + 5 + 3 = 9 cards.
    test("sequential pills in one thread render full card sequences for each", async ({
      page,
    }) => {
      test.setTimeout(240_000);

      const cards = wildcardCards(page);

      await clickSuggestion(page, "Find flights");
      await expect
        .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
        .toBe(1);

      await clickSuggestion(page, "Roll a d20");
      await expect
        .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
        .toBe(6);
      await expect(page.getByText("Rolled the d20 five times")).toBeVisible({
        timeout: TOOL_TIMEOUT,
      });

      await clickSuggestion(page, "Chain tools");
      await expect
        .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
        .toBe(9);
      await expect(page.getByText("Done — Tokyo is sunny")).toBeVisible({
        timeout: TOOL_TIMEOUT,
      });
    });
  },
);
