import { test, expect } from "@playwright/test";

// QA reference: qa/tool-rendering-default-catchall.md
// Demo source: src/app/demos/tool-rendering-default-catchall/page.tsx
//
// This cell registers ZERO custom render hooks. The runtime falls back
// to the framework's built-in DefaultToolCallRenderer, which paints
// every tool call with a stable `[data-testid="copilot-tool-render"]`
// wrapper plus a `data-tool-name="<name>"` attribute. We assert on the
// built-in contract — branded testids from sibling cells stay at zero.

const SUGGESTION_TIMEOUT = 15000;
const TOOL_TIMEOUT = 60000;

const PILLS = ["Weather in SF", "Find flights", "Roll a d20", "Chain tools"];

test.describe("Tool Rendering — Default Catch-all", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: SUGGESTION_TIMEOUT,
    });
  });

  test("page loads with composer and 4 suggestion pills", async ({ page }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    for (const title of PILLS) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: SUGGESTION_TIMEOUT,
      });
    }

    // Sanity: branded sibling-cell testids stay at zero on this cell.
    await expect(page.locator('[data-testid="weather-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="flights-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="stock-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="d20-card"]')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="custom-wildcard-card"]'),
    ).toHaveCount(0);
  });

  test("Weather in SF pill paints the built-in default card for get_weather", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Weather in SF" })
      .first()
      .click();

    const card = page
      .locator(
        '[data-testid="copilot-tool-render"][data-tool-name="get_weather"]',
      )
      .first();
    await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });

    // Args are pinned to San Francisco (verbatim pill prompt → fixture).
    await expect
      .poll(async () => card.getAttribute("data-args"), {
        timeout: TOOL_TIMEOUT,
      })
      .toContain("San Francisco");

    // No branded sibling-cell card mounted.
    await expect(page.locator('[data-testid="weather-card"]')).toHaveCount(0);
    await expect(
      page.locator('[data-testid="custom-wildcard-card"]'),
    ).toHaveCount(0);
  });

  test("Find flights pill paints the built-in default card for search_flights", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Find flights" })
      .first()
      .click();

    const card = page
      .locator(
        '[data-testid="copilot-tool-render"][data-tool-name="search_flights"]',
      )
      .first();
    await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });

    // Result attribute carries the deterministic fixture flights (NOT
    // the a2ui beautiful-chat shape).
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
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Roll a d20" })
      .first()
      .click();

    const cards = page.locator(
      '[data-testid="copilot-tool-render"][data-tool-name="roll_d20"]',
    );

    await expect
      .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
      .toBe(5);

    // 5th card's result must contain "20" (the final scripted roll).
    const lastResult = await cards.nth(4).getAttribute("data-result");
    expect(lastResult ?? "").toMatch(/"value":\s*20|"result":\s*20/);

    // First 4 results are not-20.
    for (let i = 0; i < 4; i++) {
      const r = (await cards.nth(i).getAttribute("data-result")) ?? "";
      expect(r).not.toMatch(/"value":\s*20|"result":\s*20/);
    }

    await expect(page.locator('[data-testid="d20-card"]')).toHaveCount(0);
  });

  test("Chain tools pill paints 3 default cards (weather + flights + d20)", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Chain tools" })
      .first()
      .click();

    await expect(
      page
        .locator(
          '[data-testid="copilot-tool-render"][data-tool-name="get_weather"]',
        )
        .first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      page
        .locator(
          '[data-testid="copilot-tool-render"][data-tool-name="search_flights"]',
        )
        .first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      page
        .locator(
          '[data-testid="copilot-tool-render"][data-tool-name="roll_d20"]',
        )
        .first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
  });

  test("every rendered card matches the built-in default-renderer DOM signature", async ({
    page,
  }) => {
    // Drive a single pill that produces a single card so the assertions
    // here are scoped to the exact DOM the framework's default renderer
    // produces.
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Weather in SF" })
      .first()
      .click();

    const card = page.locator('[data-testid="copilot-tool-render"]').first();
    await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });

    // The built-in default renderer always exposes name + status pill.
    await expect(
      card.locator('[data-testid="copilot-tool-render-name"]'),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      card.locator('[data-testid="copilot-tool-render-status"]'),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });

    // Every card on the page shares the same wrapper testid count as
    // the inner-name and inner-status testids — proves the built-in
    // shell is what's painting (no per-tool shells).
    const total = await page
      .locator('[data-testid="copilot-tool-render"]')
      .count();
    await expect(
      page.locator('[data-testid="copilot-tool-render-name"]'),
    ).toHaveCount(total);
    await expect(
      page.locator('[data-testid="copilot-tool-render-status"]'),
    ).toHaveCount(total);
  });
});
