import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// QA reference: qa/a2ui-recovery.md
// Demo source: src/app/demos/a2ui-recovery/{page.tsx, chat.tsx, suggestions.ts}
//
// ADK-only A2UI error recovery (OSS-158). Mirrors the AG-UI dojo reference
// (apps/dojo/e2e/tests/adkMiddlewareTests/a2uiRecovery.spec.ts): assert the
// STABLE end-states — the recovered surface paints (heal) and the hard-failure
// UI shows (exhaust) — and deliberately do NOT assert the transient
// "Retrying generation… (N/M)" label, which is threshold-gated + timing
// dependent (see @copilotkit/react-core/v2 A2UIRecoveryStates) and would be
// flaky.
//
// The aimock fixtures (showcase/aimock/d6/google-adk/a2ui-recovery.json) force
// the inner render_a2ui sub-agent to emit a structurally-invalid surface
// (unresolved child) on attempt 0 then a valid one on attempt 1 (heal), or
// invalid on every attempt (exhaust). Healing itself runs live in the ADK
// middleware (ag_ui_adk >= 0.7.0); the failure UI text ("Couldn't generate the
// UI") comes from @copilotkit/react-core/v2. The recovered surface reuses the
// declarative-gen-ui catalog, so it carries the `declarative-metric` testid.
//
// Requires the stack running with aimock (GOOGLE_GEMINI_BASE_URL -> aimock) so
// the malformed renders fire deterministically; against a real LLM the demo
// would not reliably produce the invalid attempts.

/** Click a suggestion pill and confirm the message dispatched (the user
 *  bubble with the pill's full message text appears). Copied from
 *  declarative-gen-ui.spec.ts — see that file for the rationale (slow
 *  hydration can swallow the first click; never re-click once dispatched). */
async function clickPill(page: Page, title: string, message: string) {
  const pill = page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first();
  await expect(pill).toBeVisible({ timeout: 15_000 });
  const userBubble = page
    .locator('[data-message-role="user"]')
    .filter({ hasText: message })
    .first();
  await expect(async () => {
    if ((await userBubble.count()) === 0) {
      await pill.click();
    }
    await expect(userBubble).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

const HEAL_PILL = "Recover a bad render";
const HEAL_MSG =
  "Render my Q2 sales dashboard, recovering if the first attempt is malformed.";
const EXHAUST_PILL = "Show an unrecoverable failure";
const EXHAUST_MSG =
  "Render a dashboard that keeps failing validation so I can see the fallback.";

test.describe("A2UI Error Recovery (ADK-only)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-recovery");
  });

  test("page loads with both recovery pills", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    for (const title of [HEAL_PILL, EXHAUST_PILL]) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
    // No surface on first paint.
    await expect(page.getByTestId("declarative-metric")).toHaveCount(0);
  });

  test("heal: invalid first render recovers to a valid surface", async ({
    page,
  }) => {
    await clickPill(page, HEAL_PILL, HEAL_MSG);

    // The faulty first attempt is suppressed (never paints); the recovered
    // surface paints. Recovery is a multi-LLM-call loop, so allow 90s.
    const metrics = page.locator('[data-testid="declarative-metric"]');
    await expect
      .poll(async () => await metrics.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(2);

    // The healed surface, NOT the hard-failure UI, and no render-error banners.
    await expect(page.getByText("Couldn't generate the UI")).toHaveCount(0);
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
    await expect(
      page.getByText(/Cannot create component .* without a type/i),
    ).toHaveCount(0);
  });

  test("exhaust: always-invalid render shows the hard-failure UI, no faulty surface", async ({
    page,
  }) => {
    await clickPill(page, EXHAUST_PILL, EXHAUST_MSG);

    // Hard-failure UI appears once the attempt cap is hit (A2UIRecoveryStates
    // renders this on status: "failed" = the a2ui_recovery_exhausted envelope).
    await expect(
      page.getByText("Couldn't generate the UI").first(),
    ).toBeVisible({ timeout: 90_000 });

    // No faulty surface ever paints (server-side no-wipe guarantee: middleware
    // gate + adapter recovery loop).
    await expect(page.getByTestId("declarative-metric")).toHaveCount(0);

    // Conversation remains usable after the hard failure.
    await expect(page.getByPlaceholder("Type a message")).toBeEnabled();
  });
});
