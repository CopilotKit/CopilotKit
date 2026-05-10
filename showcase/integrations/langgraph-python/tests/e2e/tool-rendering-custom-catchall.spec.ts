import { test, expect } from "@playwright/test";

// QA reference: qa/tool-rendering-custom-catchall.md
// Demo source: src/app/demos/tool-rendering-custom-catchall/page.tsx
// Renderer source: src/app/demos/tool-rendering-custom-catchall/custom-catchall-renderer.tsx
//
// This cell registers a SINGLE branded wildcard renderer via
// `useDefaultRenderTool`. Every tool call must paint via the same
// `[data-testid="custom-wildcard-card"]` shell — no per-tool
// specialization. Test 6 is the load-bearing assertion: every card on
// the page after each pill click shares the same testid signature.

const SUGGESTION_TIMEOUT = 15000;
const TOOL_TIMEOUT = 60000;

const PILLS = ["Weather in SF", "Find flights", "Roll a d20", "Chain tools"];

test.describe("Tool Rendering — Custom Catch-all (branded wildcard)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
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

    // Sanity: per-tool branded testids from sibling cells stay at zero.
    await expect(page.locator('[data-testid="weather-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="flights-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="stock-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="d20-card"]')).toHaveCount(0);
    // Sanity: the OOTB default-renderer testid does NOT appear here.
    await expect(
      page.locator('[data-testid="copilot-tool-render"]'),
    ).toHaveCount(0);
  });

  test("Weather in SF pill paints the branded wildcard card for get_weather", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Weather in SF" })
      .first()
      .click();

    const card = page
      .locator(
        '[data-testid="custom-wildcard-card"][data-tool-name="get_weather"]',
      )
      .first();
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
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Find flights" })
      .first()
      .click();

    const card = page
      .locator(
        '[data-testid="custom-wildcard-card"][data-tool-name="search_flights"]',
      )
      .first();
    await expect(card).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      card.locator('[data-testid="custom-wildcard-tool-name"]'),
    ).toHaveText("search_flights");

    // Result block surfaces the deterministic flights from our fixture
    // (NOT the a2ui beautiful-chat boilerplate).
    await expect(
      card.locator('[data-testid="custom-wildcard-result"]'),
    ).toContainText(/United|Delta|JetBlue/, { timeout: TOOL_TIMEOUT });
  });

  test("Roll a d20 pill paints exactly 5 wildcard cards, last result is 20", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Roll a d20" })
      .first()
      .click();

    const cards = page.locator(
      '[data-testid="custom-wildcard-card"][data-tool-name="roll_d20"]',
    );
    await expect
      .poll(async () => cards.count(), { timeout: TOOL_TIMEOUT })
      .toBe(5);

    // 5th card's result is 20.
    await expect(
      cards.nth(4).locator('[data-testid="custom-wildcard-result"]'),
    ).toContainText(/"value":\s*20|"result":\s*20/, { timeout: TOOL_TIMEOUT });

    // First 4 are non-20.
    for (let i = 0; i < 4; i++) {
      const txt = await cards
        .nth(i)
        .locator('[data-testid="custom-wildcard-result"]')
        .innerText();
      expect(txt).not.toMatch(/"value":\s*20|"result":\s*20/);
    }
  });

  test("Chain tools pill paints 3 wildcard cards (one per tool)", async ({
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
          '[data-testid="custom-wildcard-card"][data-tool-name="get_weather"]',
        )
        .first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      page
        .locator(
          '[data-testid="custom-wildcard-card"][data-tool-name="search_flights"]',
        )
        .first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
    await expect(
      page
        .locator(
          '[data-testid="custom-wildcard-card"][data-tool-name="roll_d20"]',
        )
        .first(),
    ).toBeVisible({ timeout: TOOL_TIMEOUT });
  });

  test("every rendered card shares the same wildcard testid signature", async ({
    page,
  }) => {
    // Cross-tool sanity: drive Chain tools (3 distinct tools → 3
    // cards) and assert every card matches the same wildcard shell.
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Chain tools" })
      .first()
      .click();

    const cards = page.locator('[data-testid="custom-wildcard-card"]');
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

    // All cards expose distinct tool names but the SAME shell.
    const toolNames = await cards.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-tool-name")),
    );
    const uniqueNames = new Set(toolNames);
    expect(uniqueNames.size).toBeGreaterThanOrEqual(3);
    for (const name of toolNames) {
      expect(["get_weather", "search_flights", "roll_d20"]).toContain(name);
    }

    // The OOTB default-renderer testid stays at zero — proves the
    // single custom wildcard is what painted, not the framework
    // fallback.
    await expect(
      page.locator('[data-testid="copilot-tool-render"]'),
    ).toHaveCount(0);
  });
});
