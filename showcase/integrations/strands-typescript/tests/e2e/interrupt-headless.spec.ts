import { test, expect } from "@playwright/test";

// QA reference: qa/interrupt-headless.md
// Demo source: src/app/demos/interrupt-headless/page.tsx
//
// Same NATIVE interrupt backend as gen-ui-interrupt (the `schedule_meeting`
// tool calls Strands' `interrupt(...)` → AG-UI bridge → AG-UI interrupt
// outcome). The DIFFERENCE is the frontend: `useInterrupt({ renderInChat:
// false })` returns the picker element, which the demo places in the LEFT
// app-surface pane instead of the chat.
// Mirrors the D6 harness probe harness/src/probes/scripts/d5-interrupt-headless.ts.
//
// App-surface states (mutually exclusive):
//   - `interrupt-headless-empty` : nothing scheduled / picker resolved
//   - `interrupt-headless-popup` : picker mounted on a live suspend
//   - `interrupt-headless-slot-<iso>`: per-slot buttons inside the popup
//
// Typed prompts (not pills) drive the tool-trigger: pill-click was observed to
// not always drive schedule_meeting on Railway. No LLM-text assertions; the
// popup→empty transition + assistant continuation is the genuine resolve→resume
// signal.

test.describe("Interrupt (headless, app-surface picker)", () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    const runtimeReady = page.waitForResponse(
      (res) =>
        res.url().includes("/api/copilotkit") &&
        res.request().method() === "POST" &&
        res.status() === 200,
    );
    await page.goto("/demos/interrupt-headless");
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
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Book an intro call with the sales team to discuss pricing.",
    );
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // Contract: the picker mounts in the app-surface pane, NOT inside the chat.
    // Scoped to that pane so the assertion actually holds the contract: an
    // unscoped locator would pass just as well if the popup rendered in chat.
    const popup = page
      .locator('[data-testid="interrupt-headless-app-surface"]')
      .locator('[data-testid="interrupt-headless-popup"]');
    await expect(popup).toBeVisible({ timeout: 60_000 });

    const slot = page
      .locator('[data-testid^="interrupt-headless-slot-"]')
      .first();
    await expect(slot).toBeVisible({ timeout: 15_000 });
    await slot.click();

    // resolve({chosen_time, chosen_label}) → runAgent resume → popup unmounts
    // back to the empty state.
    await expect(
      page.locator('[data-testid="interrupt-headless-empty"]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(popup).toHaveCount(0);

    // Positive narration, symmetric with the cancel test below: the picker
    // unmounting only proves the element went away, not that the resumed run
    // reached the model and came back with the booking.
    const narration = page
      .locator('[data-testid="copilot-assistant-message"]')
      .last();
    await expect(narration).toBeVisible({ timeout: 45_000 });
    // Pin the slot the user picked, not just the word "scheduled": the
    // did-not-pick branch reads "Meeting NOT scheduled", which matches a bare
    // /scheduled/i and let a broken resume pass. Matching the time keeps this
    // phrasing-agnostic for a live model while still failing a lost answer.
    await expect(narration).toContainText(/10:00/, { timeout: 45_000 });
    await expect(narration).not.toContainText(
      /not scheduled|did not pick|didn'?t pick/i,
    );
  });

  test("cancel path: dismissing the picker resumes the run", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Schedule a 1:1 with Alice next week to review Q2 goals.");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const popup = page.locator('[data-testid="interrupt-headless-popup"]');
    await expect(popup).toBeVisible({ timeout: 60_000 });

    const bubbles = page.locator('[data-testid="copilot-assistant-message"]');
    const bubblesBeforeCancel = await bubbles.count();

    await page.locator('[data-testid="interrupt-headless-cancel"]').click();

    // resolve({cancelled:true}) → resume → popup unmounts back to empty.
    await expect(
      page.locator('[data-testid="interrupt-headless-empty"]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(popup).toHaveCount(0);

    // The cancelled resume has to produce a NEW assistant bubble. The pre-pause
    // text is already on screen, so asserting one is visible proves nothing;
    // counting is phrasing-agnostic and holds against a real model too.
    await expect
      .poll(() => bubbles.count(), { timeout: 45_000 })
      .toBeGreaterThan(bubblesBeforeCancel);

    // Wait for the resumed run to actually finish before reading its final
    // text. A bubble appears as soon as streaming starts, and a negative
    // assertion passes against a partial string: a response streaming "B" and
    // then "Booked: ..." would slip through while it is still one character
    // long. With an empty composer this control disables once the run ends.
    await expect(
      page.locator('[data-testid="copilot-send-button"]').first(),
    ).toBeDisabled({ timeout: 45_000 });

    // Regression (cancel-path narration): cancel resumes with the SAME
    // toolCallId as pick, so before aimock 1.37.0's toolResultContains gate the
    // resume matched the pick-confirmation fixture and the assistant replayed
    // a booking confirmation after the user cancelled. The ABSENCE of a
    // confirmation is what catches that, and it survives a live model.
    const assistant = page
      .locator('[data-testid="copilot-assistant-message"]')
      .last();
    await expect(assistant).not.toContainText("Scheduled:");
    await expect(assistant).not.toContainText("Booked:");
  });
});
