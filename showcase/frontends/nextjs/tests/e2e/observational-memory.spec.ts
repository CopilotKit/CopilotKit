import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Observational Memory: Mastra's Observational Memory (OM), shown as activity
// cards.
//
// Demo: src/app/demos/[integration]/observational-memory/
// Manual QA: showcase/integrations/mastra/qa/observational-memory.md
//
// As the conversation grows past a token threshold, Mastra runs an Observer
// out of band. The Observer compresses the unobserved messages into
// observations and activates them. That work streams on the run's
// `fullStream` as `data-om-*` chunks. The Mastra AG-UI adapter maps the
// chunks to `mastra-observational-memory` activity events, and the page's
// `observationalMemoryActivityRenderer` draws them inline.
//
// What these tests can check (read this before you change an assertion):
// under aimock, the STRUCTURE of the OM lifecycle is deterministic, but its
// content is not.
// - A single large pill click always trips the token threshold. Within that
//   turn it shows exactly one card, in the `buffering / running` phase. Token
//   counting is deterministic for the fixed pill size, so this does not
//   depend on the Observer's LLM response.
// - The Observer's out-of-band LLM call also goes through aimock, so the
//   cycle does complete and activate. That delta lands just after the turn,
//   so it shows on the next run: after a second large turn, the first
//   cycle's card reads `activation / activated`, and a new
//   `buffering / running` card appears for the new turn.
// aimock does not reproduce real observation text: it answers the Observer
// call with a stand-in, not a real compression. The real-LLM QA pass and the
// adapter's own unit tests cover the observation content. These tests check
// the lifecycle structure only.

const ANALYTICS_PILL = "Brief my analytics project";
const TRIP_PILL = "Plan a two-week trip";

function suggestionPill(page: Page, title: string) {
  return page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first();
}

function assistantMessage(page: Page, index: number) {
  return page.locator('[data-testid="copilot-assistant-message"]').nth(index);
}

function omCards(page: Page) {
  return page.locator('[data-testid="om-activity-card"]');
}

// Turn 1, the analytics brief. A fixture answers it (it matches "Northwind
// Insights"), so an assistant message must appear. The large pill trips OM's
// token threshold, so exactly one OM card appears within the turn.
async function sendAnalyticsBrief(page: Page) {
  await suggestionPill(page, ANALYTICS_PILL).click();
  await expect(assistantMessage(page, 0)).toBeVisible({ timeout: 45_000 });
  await expect(omCards(page)).toHaveCount(1, { timeout: 15_000 });
}

describeDemo("observational-memory", "Observational Memory (Mastra)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("observational-memory"));
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    // No activity card on first paint.
    await expect(omCards(page)).toHaveCount(0);
  });

  test("both suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    await expect(suggestionPill(page, ANALYTICS_PILL)).toBeVisible({
      timeout: 15_000,
    });
    await expect(suggestionPill(page, TRIP_PILL)).toBeVisible({
      timeout: 15_000,
    });
  });

  test("clicking the analytics pill produces an assistant response and an OM cycle", async ({
    page,
  }) => {
    await sendAnalyticsBrief(page);

    // The in-turn card is in the `buffering / running` phase. Completion and
    // activation trail out of band (see the next test).
    const card = omCards(page).first();
    await expect(card).toHaveAttribute("data-om-phase", "buffering");
    await expect(card).toHaveAttribute("data-om-status", "running");
  });

  test("a second sizable turn settles the first OM cycle to activated", async ({
    page,
  }) => {
    await sendAnalyticsBrief(page);

    // Turn 2, the trip brief, in the same session. By the time this run
    // streams, the Observer has finished the first cycle out of band, so its
    // card advances to `activation / activated`. The new turn opens a fresh
    // `buffering / running` cycle.
    await suggestionPill(page, TRIP_PILL).click();
    await expect(assistantMessage(page, 1)).toBeVisible({ timeout: 45_000 });

    await expect(omCards(page)).toHaveCount(2, { timeout: 20_000 });
    // One card has moved past `running`: its cycle completed and activated
    // out of band. `completed` and `activated` can race on the delta, so
    // either status passes.
    await expect(
      page.locator(
        '[data-testid="om-activity-card"][data-om-status="activated"], [data-testid="om-activity-card"][data-om-status="completed"]',
      ),
    ).toHaveCount(1, { timeout: 20_000 });
  });
});
