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
// DETERMINISM SCOPE (important — read before changing assertions):
// The OM activity LIFECYCLE is deterministic under aimock, but only its
// STRUCTURE, not its semantic content:
//   * A single sizable pill click always trips the token threshold and paints
//     exactly one card in the `buffering / running` phase in-turn (token
//     accounting is deterministic given the fixed pill size; this does NOT
//     depend on the Observer LLM response).
//   * The Observer's out-of-band LLM call goes through aimock too, so the cycle
//     DOES complete and activate — but that delta lands just AFTER the turn, so
//     it surfaces on the NEXT run: after a second sizable turn the first cycle's
//     card reads `activation / activated` and a fresh `buffering / running`
//     card appears for the new turn.
// What aimock does NOT reproduce is the real OBSERVATION TEXT (aimock returns a
// stand-in for the Observer call, not a genuine compression), so the observed-
// content quality is covered by the real-LLM QA pass (qa/observational-memory.md)
// and the adapter's own unit tests upstream. These specs assert the lifecycle
// structure only.

test.describe("Observational Memory (Mastra)", () => {
  test.setTimeout(120_000);

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

  test("clicking the analytics pill produces an assistant response and an OM cycle", async ({
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

    // Deterministic: the sizable pill trips OM's token threshold, so exactly
    // one Observational Memory activity card surfaces in-turn, in the
    // `buffering / running` phase. (Completion/activation trails out of band —
    // see the interleaved test below and the determinism note above.)
    const omCard = page.locator('[data-testid="om-activity-card"]');
    await expect(omCard).toHaveCount(1, { timeout: 15_000 });
    await expect(omCard.first()).toHaveAttribute("data-om-phase", "buffering");
    await expect(omCard.first()).toHaveAttribute("data-om-status", "running");
  });

  test("a second sizable turn settles the first OM cycle to activated", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    const omCard = page.locator('[data-testid="om-activity-card"]');

    // Turn 1 — analytics brief.
    await suggestions
      .filter({ hasText: "Brief my analytics project" })
      .first()
      .click();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45_000 });
    await expect(omCard).toHaveCount(1, { timeout: 15_000 });

    // Turn 2 — trip brief in the SAME session. By the time this run streams,
    // the Observer has completed the first cycle out of band, so its card
    // advances to `activation / activated`; the new turn opens a fresh
    // `buffering / running` cycle. (Deterministic under aimock: 5/5 local.)
    await suggestions
      .filter({ hasText: "Plan a two-week trip" })
      .first()
      .click();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').nth(1),
    ).toBeVisible({ timeout: 45_000 });

    await expect(omCard).toHaveCount(2, { timeout: 20_000 });
    // At least one card has progressed past `running` — its cycle completed and
    // activated out of band. Accept either terminal status (`completed` and
    // `activated` can race on the delta); locally this is `activated` (5/5).
    await expect(
      page.locator(
        '[data-testid="om-activity-card"][data-om-status="activated"], [data-testid="om-activity-card"][data-om-status="completed"]',
      ),
    ).toHaveCount(1, { timeout: 20_000 });
  });
});
