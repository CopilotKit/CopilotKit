import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// QA reference: qa/a2ui-recovery.md
// Demo source: src/app/demos/a2ui-recovery/{page.tsx, chat.tsx, suggestions.ts}
//
// A2UI error recovery (OSS-158 / OSS-375). Assert the STABLE end-states — the
// recovered surface paints (heal) and the hard-failure UI shows (exhaust) — and
// deliberately do NOT assert the transient "Retrying generation… (N/M)" label,
// which is threshold-gated + timing dependent (see @copilotkit/react-core/v2
// A2UIRecoveryStates) and would be flaky.
//
// The aimock fixtures (showcase/aimock/d6/google-antigravity/a2ui-recovery.json)
// drive the inner render_a2ui sub-agent call two ways: HEAL is structurally
// invalid (the root references a missing child) on the first attempt and valid
// once the retry prompt carries the validation errors; EXHAUST is invalid on
// every attempt, so the validate->retry loop hits the cap and returns the
// a2ui_recovery_exhausted envelope. The loop runs in the backend's
// generate_a2ui server tool (src/agents/a2ui_dynamic.py, wired by
// src/agents/a2ui_recovery.py; the route sets injectA2UITool=false);
// the failure UI text ("Couldn't generate the UI") comes from
// @copilotkit/react-core/v2. The recovered surface reuses the
// declarative-gen-ui catalog, so it carries the `declarative-metric` testid.
//
// Requires the stack running with aimock so the malformed renders fire
// deterministically; against a real LLM the demo would not reliably produce the
// invalid attempts.

/** Click a suggestion pill and confirm the message dispatched (the user
 *  bubble with the pill's full message text appears). The user bubble is
 *  matched by `data-testid="copilot-user-message"`. Slow hydration can swallow
 *  the first click, so we retry; never re-click once dispatched. */
async function clickPill(page: Page, title: string, message: string) {
  const pill = page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first();
  await expect(pill).toBeVisible({ timeout: 15_000 });
  const userBubble = page
    .locator('[data-testid="copilot-user-message"]')
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
  "Chart the Antigravity quarterly revenue board and repair a malformed first render.";
const EXHAUST_PILL = "Show an unrecoverable failure";
const EXHAUST_MSG =
  "Chart an Antigravity board that never passes validation so I can preview the fallback.";

test.describe("A2UI Error Recovery", () => {
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

  test("heal: an invalid first render is retried into a valid surface", async ({
    page,
  }) => {
    await clickPill(page, HEAL_PILL, HEAL_MSG);

    // The first render attempt fails validation; the backend retries with the
    // errors in the prompt and the second attempt paints. Allow 90s for the
    // sub-agent round-trips.
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
