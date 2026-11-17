import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo, integration } from "./helpers";

// Demo source: src/app/demos/[integration]/interrupt-headless/
//
// Same scheduling agent as gen-ui-interrupt. The DIFFERENCE is the frontend:
// the picker mounts in the LEFT app-surface pane instead of the chat. The
// agent either pauses the run with an interrupt (`useInterrupt` with
// `renderInChat: false`) or calls a tool the page registers
// (`useFrontendTool`), as the config of the integration says. The pane and
// its states are the same either way, so every test holds for both.
//
// App-surface states (mutually exclusive):
//   - `interrupt-headless-empty`: nothing scheduled, or the picker resolved
//   - `interrupt-headless-popup`: the picker, while the agent waits
//   - `interrupt-headless-slot-<iso>`: per-slot buttons inside the popup
//
// Typed prompts (not pills) drive the tool call: a pill click was observed to
// not always drive schedule_meeting on Railway. No LLM-text assertions: the
// popup-to-empty transition plus a new assistant message is the signal that
// the answer reached the agent.

const DEMO = "interrupt-headless";

// Resolves on the first answer from the demo's runtime, the runtime info.
// A message sent before it is silently dropped: the chat's agent is still a
// stand-in, and the real agent replaces its subscribers when it arrives.
function waitForRuntime(page: Page) {
  const runtimePath = `/api/${integration}/${DEMO}`;
  return page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname.startsWith(runtimePath) &&
      res.status() === 200,
  );
}

async function send(page: Page, prompt: string) {
  await page.getByPlaceholder("Type a message").fill(prompt);
  await page.locator('[data-testid="copilot-send-button"]').first().click();
}

describeDemo(DEMO, "Interrupt (headless, app-surface picker)", () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    const runtimeReady = waitForRuntime(page);
    await page.goto(demoPath(DEMO));
    await runtimeReady;
  });

  test("page loads with the empty app surface and no popup", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="interrupt-headless-empty"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="interrupt-headless-popup"]'),
    ).toHaveCount(0);
  });

  test("both suggestion pills render", async ({ page }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "Book a call with sales" }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      suggestions.filter({ hasText: "Schedule a 1:1 with Alice" }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("picking a slot in the app surface resumes the run", async ({
    page,
  }) => {
    await send(
      page,
      "Book an intro call with the sales team to discuss pricing.",
    );

    // Contract: the picker mounts in the app-surface pane, NOT inside the chat.
    // Scoped to that pane so the assertion actually holds the contract: an
    // unscoped locator would pass just as well if the popup rendered in chat.
    const popup = page
      .locator('[data-testid="interrupt-headless-app-surface"]')
      .locator('[data-testid="interrupt-headless-popup"]');
    await expect(popup).toBeVisible({ timeout: 60_000 });

    // The attendee travels from the tool call through the agent's bridge, so
    // seeing it proves the page reads this integration's payload.
    await expect(popup.getByText(/Sales team/i)).toBeVisible();

    // Count the bubbles BEFORE the pick, so the check below needs a NEW one.
    // The pre-pause bubble is already on screen.
    const bubbles = page.locator('[data-testid="copilot-assistant-message"]');
    const bubblesBeforePick = await bubbles.count();

    const slot = popup
      .locator('[data-testid^="interrupt-headless-slot-"]')
      .first();
    await expect(slot).toBeVisible({ timeout: 15_000 });
    await slot.click();

    // The answer goes back to the agent, and the popup unmounts back to the
    // empty state.
    await expect(
      page.locator('[data-testid="interrupt-headless-empty"]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(popup).toHaveCount(0);

    await expect
      .poll(() => bubbles.count(), { timeout: 45_000 })
      .toBeGreaterThan(bubblesBeforePick);
  });

  test("cancel path: dismissing the picker resumes the run", async ({
    page,
  }) => {
    await send(page, "Schedule a 1:1 with Alice next week to review Q2 goals.");

    const popup = page.locator('[data-testid="interrupt-headless-popup"]');
    await expect(popup).toBeVisible({ timeout: 60_000 });

    const bubbles = page.locator('[data-testid="copilot-assistant-message"]');
    const bubblesBeforeCancel = await bubbles.count();

    await page.locator('[data-testid="interrupt-headless-cancel"]').click();

    // The cancel goes back to the agent, and the popup unmounts back to the
    // empty state.
    await expect(
      page.locator('[data-testid="interrupt-headless-empty"]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(popup).toHaveCount(0);

    // The pre-pause text is already on screen, so the run has to produce a NEW
    // assistant bubble. Counting holds for any phrasing, live or recorded.
    await expect
      .poll(() => bubbles.count(), { timeout: 45_000 })
      .toBeGreaterThan(bubblesBeforeCancel);
  });
});
