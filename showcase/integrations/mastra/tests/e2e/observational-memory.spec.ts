import { test, expect } from "@playwright/test";

// QA reference: qa/observational-memory.md
// Demo source: src/app/demos/observational-memory/page.tsx
// Backend: src/mastra/agents/index.ts (observationalMemoryAgent — OM enabled
//   on its Memory via options.observationalMemory)
// Runtime: src/app/api/copilotkit-observational-memory/route.ts
//   (getLocalAgents({ observationalMemory: true }) surfaces the OM activity)
//
// Pattern: Mastra Observational Memory (OM) surfaced as AG-UI ACTIVITY events.
// As the conversation grows past a token threshold, Mastra runs an Observer
// OUT OF BAND that compresses unobserved messages into observations and
// activates them. That work streams on the run's `fullStream` as `data-om-*`
// chunks; the adapter maps them to `mastra-observational-memory` activity
// events, which the custom `observationalMemoryActivityRenderer` paints inline.
//
// DETERMINISM SCOPE (important — read before adding assertions):
// The OM activity card is NOT deterministically reproducible under aimock.
// The `data-om-*` chunks are produced by @mastra/memory's OM processor on the
// run's fullStream (driven by runtime token accounting + an out-of-band
// Observer LLM call), NOT by the mocked chat-completion response. aimock has
// no lever to force those chunks, and OM completion/activation is timing-
// adjacent (the in-turn card often reads "Working"). So this spec asserts the
// DETERMINISTIC subset only: the page loads, both sizable pills render, and a
// pill click produces a completing assistant turn. The OM card itself is
// covered by a best-effort (non-failing) probe and by a real-LLM QA pass
// (qa/observational-memory.md), plus the adapter's own unit tests upstream.

test.describe("Observational Memory (Mastra)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/observational-memory");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // No activity card on first paint.
    await expect(page.locator('[data-testid="om-activity-card"]')).toHaveCount(
      0,
    );
  });

  test("both suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "Brief my analytics project" }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      suggestions.filter({ hasText: "Plan a two-week trip" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("clicking the analytics pill produces an assistant response", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await suggestions
      .filter({ hasText: "Brief my analytics project" })
      .first()
      .click();

    // Deterministic: the actor turn is fixture-backed (substring "Northwind
    // Insights"), so an assistant message must appear.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45_000 });

    // Best-effort (non-failing) OM probe: if the OM processor fired and the
    // bridge surfaced the activity within the turn, the card will be present.
    // We do NOT assert on it — it is timing/LLM dependent (see scope note).
    const omCard = page.locator('[data-testid="om-activity-card"]');
    const omCount = await omCard.count();
    console.log(
      `[observational-memory] OM activity cards rendered: ${omCount}`,
    );
  });
});
