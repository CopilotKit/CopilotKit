import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demoPath, describeDemo, integration } from "./helpers";

// Demo source: src/app/demos/[integration]/gen-ui-interrupt/
//
// When the agent's `schedule_meeting` tool needs the user, a `TimePickerCard`
// renders INLINE in the chat transcript (no portal). The agent either pauses
// the run with an interrupt (`useInterrupt`) or calls a tool the page
// registers (`useHumanInTheLoop`), as the config of the integration says.
// The card and its states are the same either way, so every test holds for
// both.
//
// Card states (mutually exclusive, per pause):
//   - `time-picker-card`: initial, 4 slot buttons + "None of these work"
//   - `time-picker-picked`: after a slot is clicked
//   - `time-picker-cancelled`: after the ghost cancel button
//
// Typed prompts (not suggestion pills) drive the tool call: a pill click was
// observed to not always drive schedule_meeting on Railway. No LLM-text
// assertions: only test-id states, the inline render contract, and a new
// assistant message once the run continues.

const DEMO = "gen-ui-interrupt";

const SLOT_LABELS = [
  "Tomorrow 10:00 AM",
  "Tomorrow 2:00 PM",
  "Monday 9:00 AM",
  "Monday 3:30 PM",
];

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

async function askForPicker(page: Page, prompt: string) {
  await page.getByPlaceholder("Type a message").fill(prompt);
  await page.locator('[data-testid="copilot-send-button"]').first().click();

  const card = page.locator('[data-testid="time-picker-card"]').first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  return card;
}

describeDemo(DEMO, "Gen UI interrupt (inline time picker)", () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    const runtimeReady = waitForRuntime(page);
    await page.goto(demoPath(DEMO));
    await runtimeReady;
  });

  test("page loads with chat input and no picker rendered", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(page.locator('[data-testid="time-picker-card"]')).toHaveCount(
      0,
    );
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

  test("picking a slot transitions the card to the picked state", async ({
    page,
  }) => {
    const card = await askForPicker(
      page,
      "Use schedule_meeting to book an intro call with the sales team about pricing.",
    );

    // Contract: inline render, NOT a body portal (unlike hitl-in-app).
    await expect(
      page.locator('body > [data-testid="time-picker-card"]'),
    ).toHaveCount(0);

    // The attendee travels from the tool call through the agent's bridge, so
    // seeing it proves the page reads this integration's payload.
    await expect(card.getByText(/Sales team/i)).toBeVisible();
    for (const label of SLOT_LABELS) {
      await expect(card.getByRole("button", { name: label })).toBeVisible();
    }
    await expect(
      card.getByRole("button", { name: "None of these work" }),
    ).toBeVisible();

    // Count the bubbles BEFORE the pick, so the check below needs a NEW one.
    // The pre-pause bubble is already on screen.
    const bubbles = page.locator('[data-testid="copilot-assistant-message"]');
    const bubblesBeforePick = await bubbles.count();

    await card.getByRole("button", { name: "Monday 9:00 AM" }).click();

    // One assertion for state and text: after an interrupt, the picked card
    // goes away once the run resumes.
    await expect(
      page
        .locator('[data-testid="time-picker-picked"]')
        .filter({ hasText: "Monday 9:00 AM" })
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    // The picked-state card replaces the interactive card.
    await expect(page.locator('[data-testid="time-picker-card"]')).toHaveCount(
      0,
    );

    await expect
      .poll(() => bubbles.count(), { timeout: 45_000 })
      .toBeGreaterThan(bubblesBeforePick);
  });

  test("cancel path: None-of-these-work transitions to cancelled state", async ({
    page,
  }) => {
    const card = await askForPicker(
      page,
      "Use schedule_meeting to book a 1:1 with Alice next week to review Q2 goals.",
    );

    const bubbles = page.locator('[data-testid="copilot-assistant-message"]');
    const bubblesBeforeCancel = await bubbles.count();

    await card.getByRole("button", { name: "None of these work" }).click();

    await expect(
      page
        .locator('[data-testid="time-picker-cancelled"]')
        .filter({ hasText: "Cancelled" })
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(() => bubbles.count(), { timeout: 45_000 })
      .toBeGreaterThan(bubblesBeforeCancel);
  });
});
