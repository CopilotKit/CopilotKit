import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// A2UI error recovery. These tests check the stable end states: the healed
// surface paints, or the failure state shows. They do not check the
// transient "Retrying generation... (N/M)" label, which depends on a
// threshold and on timing (see A2UIRecoveryStates in
// @copilotkit/react-core/v2).
//
// The aimock fixtures drive the inner render call two ways:
// - heal: the first render is invalid, and the retry heals it into a valid
//   surface;
// - exhaust: every render is invalid, so the validate and retry loop hits its
//   cap and returns the recovery-exhausted result.
// The failure text ("Couldn't generate the UI") comes from
// @copilotkit/react-core/v2. The healed surface uses the declarative-gen-ui
// catalog, so it has `declarative-metric` tiles.
//
// The pill messages are the fixture keys, and they differ by integration
// (see the a2ui-recovery settings in src/integrations/<slug>/demos). So the
// tests click a pill by its title and wait for any user bubble.
//
// The stack must run with aimock: a real model would not reliably produce the
// invalid renders.

/** Clicks a suggestion pill and waits until its message is sent: a user
 *  bubble (`copilot-user-message`) appears. During slow hydration the first
 *  click can be lost, so it retries, but it never clicks again once the
 *  message was sent. The page has no messages before the click. */
async function clickPill(page: Page, title: string) {
  const pill = page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: title })
    .first();
  await expect(pill).toBeVisible({ timeout: 15_000 });
  const userBubble = page
    .locator('[data-testid="copilot-user-message"]')
    .first();
  await expect(async () => {
    if ((await userBubble.count()) === 0) {
      await pill.click();
    }
    await expect(userBubble).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
}

const HEAL_PILL = "Recover a bad render";
const EXHAUST_PILL = "Show an unrecoverable failure";

describeDemo("a2ui-recovery", "A2UI Error Recovery", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("a2ui-recovery"));
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

  test("heal: an invalid first render is healed into a valid surface", async ({
    page,
  }) => {
    await clickPill(page, HEAL_PILL);

    // The retry heals the invalid render into a valid surface that paints.
    // The sub-agent round trips can take up to 90s.
    const metrics = page.locator('[data-testid="declarative-metric"]');
    await expect
      .poll(async () => await metrics.count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(2);

    // The healed surface shows, not the failure state, and no render-error
    // banners.
    await expect(page.getByText("Couldn't generate the UI")).toHaveCount(0);
    await expect(page.getByText(/Catalog not found/i)).toHaveCount(0);
    await expect(
      page.getByText(/Cannot create component .* without a type/i),
    ).toHaveCount(0);
  });

  test("exhaust: always-invalid render shows the hard-failure UI, no faulty surface", async ({
    page,
  }) => {
    await clickPill(page, EXHAUST_PILL);

    // The failure state shows once the attempt cap is hit. A2UIRecoveryStates
    // renders it for status "failed", the recovery-exhausted result.
    await expect(
      page.getByText("Couldn't generate the UI").first(),
    ).toBeVisible({ timeout: 90_000 });

    // No faulty surface ever paints.
    await expect(page.getByTestId("declarative-metric")).toHaveCount(0);

    // The conversation stays usable after the failure.
    await expect(page.getByPlaceholder("Type a message")).toBeEnabled();
  });
});
