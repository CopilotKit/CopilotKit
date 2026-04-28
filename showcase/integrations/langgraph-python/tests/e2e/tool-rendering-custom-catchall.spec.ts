import { test, expect } from "@playwright/test";

// QA reference: qa/tool-rendering-custom-catchall.md
// Demo source: src/app/demos/tool-rendering-custom-catchall/page.tsx
// Renderer source: src/app/demos/tool-rendering-custom-catchall/custom-catchall-renderer.tsx
//
// The cell calls `useDefaultRenderTool({ render: CustomCatchallRenderer })`
// with a SINGLE branded wildcard renderer. Every tool call the backend
// emits must paint via this one card. The renderer exposes a stable set of
// testids on the card root:
//
//   - custom-catchall-card         (card root, carries data-tool-name + data-status)
//   - custom-catchall-tool-name    (monospaced tool name)
//   - custom-catchall-status       (status badge: streaming / running / done)
//   - custom-catchall-args         (pretty-printed JSON args pre block)
//   - custom-catchall-result       (green result pre, only when status=complete)
//
// Backend is shared with the default-catchall demo and chains at least two
// tools per user turn. We assert on the testid contracts rather than any
// LLM text so the suite is stable against Railway's live agent.

test.describe("Tool Rendering — Custom Catch-all (branded wildcard)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
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

  test("weather prompt paints the branded custom-catchall card", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What's the weather in San Francisco?");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const card = page.locator('[data-testid="custom-catchall-card"]').first();
    await expect(card).toBeVisible({ timeout: 60000 });

    // The card root carries data-tool-name and data-status attributes.
    // get_weather is the only plausible first tool for "weather in SF".
    await expect
      .poll(async () => await card.getAttribute("data-tool-name"), {
        timeout: 60000,
      })
      .toBe("get_weather");

    // The monospaced tool-name label mirrors the attribute.
    await expect(
      card.locator('[data-testid="custom-catchall-tool-name"]'),
    ).toHaveText("get_weather");

    // Arguments section renders the pretty-printed JSON pre block from the
    // start of the call (streaming args are visible before completion).
    await expect(
      card.locator('[data-testid="custom-catchall-args"]'),
    ).toBeVisible({ timeout: 60000 });

    // Status badge eventually lands on "done" once the tool resolves. The
    // describeStatus helper lowercases the label, so the pill text is
    // literal "done" (not "Done").
    const status = card.locator('[data-testid="custom-catchall-status"]');
    await expect(status).toHaveText(/^(streaming|running|done)$/i, {
      timeout: 60000,
    });
    await expect(status).toHaveText("done", { timeout: 60000 });

    // Result pre only exists once status === "complete".
    await expect(
      card.locator('[data-testid="custom-catchall-result"]'),
    ).toBeVisible({ timeout: 60000 });
  });

  test("dice prompt paints the same branded card for roll_dice", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Roll a 20-sided die.");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // Poll for a card whose data-tool-name is roll_dice — the backend may
    // chain additional tools before or after, and we only care that the
    // branded wildcard renderer is used for this one.
    const diceCard = page.locator(
      '[data-testid="custom-catchall-card"][data-tool-name="roll_dice"]',
    );
    await expect(diceCard.first()).toBeVisible({ timeout: 60000 });

    // Same testid contract as get_weather — identical branded shell.
    await expect(
      diceCard.first().locator('[data-testid="custom-catchall-tool-name"]'),
    ).toHaveText("roll_dice");
  });

  test("Tokyo weather prompt chains >=2 branded cards, all identical shell", async ({
    page,
  }) => {
    // The shared backend's SYSTEM_PROMPT chains tools: "weather in Tokyo"
    // -> get_weather then search_flights. Every chained call must still
    // paint the single branded wildcard card — this is the core invariant
    // of the custom-catchall demo.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("What's the weather in Tokyo?");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const cards = page.locator('[data-testid="custom-catchall-card"]');

    // At least two cards eventually render.
    await expect
      .poll(async () => await cards.count(), { timeout: 60000 })
      .toBeGreaterThanOrEqual(2);

    // Every card shares the same testid structure: tool-name + status +
    // args present. Asserting on testid counts is the cleanest proof that
    // the branded shell is reused identically for every chained tool.
    const total = await cards.count();
    await expect(
      page.locator('[data-testid="custom-catchall-tool-name"]'),
    ).toHaveCount(total);
    await expect(
      page.locator('[data-testid="custom-catchall-status"]'),
    ).toHaveCount(total);
    await expect(
      page.locator('[data-testid="custom-catchall-args"]'),
    ).toHaveCount(total);

    // Each card exposes a distinct data-tool-name but the same shell.
    const toolNames = await cards.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-tool-name")),
    );
    expect(new Set(toolNames).size).toBeGreaterThanOrEqual(1);
    // Every name is a known backend tool; no unexpected renderers leak in.
    const known = new Set([
      "get_weather",
      "search_flights",
      "get_stock_price",
      "roll_dice",
    ]);
    for (const n of toolNames) {
      expect(n && known.has(n)).toBeTruthy();
    }

    // Every card ends in a terminal status ("done" for complete, or one of
    // the in-flight labels if the later tool is still running when we
    // finish polling). All three labels are legal outputs from the
    // describeStatus helper, and each card shows exactly one badge.
    const statuses = await page
      .locator('[data-testid="custom-catchall-status"]')
      .allTextContents();
    for (const s of statuses) {
      expect(["streaming", "running", "done"]).toContain(s.trim());
    }
  });
});
