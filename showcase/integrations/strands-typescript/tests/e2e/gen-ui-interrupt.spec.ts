import { test, expect } from "@playwright/test";

// QA reference: qa/gen-ui-interrupt.md
// Demo source: src/app/demos/gen-ui-interrupt/{page.tsx, time-picker-card.tsx}
//
// Uses `useInterrupt({ renderInChat: true })` — the low-level CopilotKit
// primitive wired to Strands' native `context.interrupt(...)` on the
// dedicated interrupt agent (`src/agent/interrupt-agent.ts`, shared with
// `interrupt-headless`). When the agent invokes the backend
// `schedule_meeting` tool, the tool pauses and a `TimePickerCard` renders
// INLINE in the chat transcript (no portal).
//
// Card states (mutually exclusive, per-interrupt):
//   - `time-picker-card`      — initial, 4 slot buttons + "None of these work"
//   - `time-picker-picked`    — after a slot is clicked
//   - `time-picker-cancelled` — after the ghost cancel button
//
// Typed prompts (not suggestion pills) are used for the tool-trigger flows:
// pill-click was observed to not always drive schedule_meeting on Railway.
// No LLM-text assertions — only testid state transitions plus the inline
// (non-body) render contract.

test.describe("Gen UI via useInterrupt (inline time picker)", () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    // Wait for the CopilotKit runtime info response to complete before
    // interacting. Without this, messages sent before the runtime
    // connects are silently dropped because the agent reference used by
    // CopilotChat's submit handler is a provisional stub whose
    // onMessagesChanged subscribers are replaced when the real agent
    // arrives — orphaning the in-flight run's state updates.
    const runtimeReady = page.waitForResponse(
      (res) =>
        res.url().includes("/api/copilotkit") &&
        res.request().method() === "POST" &&
        res.status() === 200,
    );
    await page.goto("/demos/gen-ui-interrupt");
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
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Use schedule_meeting to book an intro call with the sales team about pricing.",
    );
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const card = page.locator('[data-testid="time-picker-card"]').first();
    await expect(card).toBeVisible({ timeout: 60_000 });

    // Contract: inline render, NOT a body portal (unlike hitl-in-app).
    await expect(
      page.locator('body > [data-testid="time-picker-card"]'),
    ).toHaveCount(0);

    const expectedSlots = [
      "Tomorrow 10:00 AM",
      "Tomorrow 2:00 PM",
      "Monday 9:00 AM",
      "Monday 3:30 PM",
    ];
    for (const label of expectedSlots) {
      await expect(card.getByRole("button", { name: label })).toBeVisible();
    }
    await expect(
      card.getByRole("button", { name: "None of these work" }),
    ).toBeVisible();

    await card.getByRole("button", { name: "Monday 9:00 AM" }).click();

    const picked = page.locator('[data-testid="time-picker-picked"]').first();
    await expect(picked).toBeVisible({ timeout: 10_000 });
    await expect(picked).toContainText("Monday 9:00 AM");

    // The picked-state card replaces the interactive card.
    await expect(page.locator('[data-testid="time-picker-card"]')).toHaveCount(
      0,
    );

    // The LAST bubble, not the first: the first is the pre-pause "let me check
    // available times" text, which is on screen before the resume happens, so
    // asserting on it passes even when the resume never lands.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').last(),
    ).toBeVisible({
      timeout: 45_000,
    });
  });

  test("cancel path: None-of-these-work transitions to cancelled state", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Use schedule_meeting to book a 1:1 with Alice next week to review Q2 goals.",
    );
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const card = page.locator('[data-testid="time-picker-card"]').first();
    await expect(card).toBeVisible({ timeout: 60_000 });

    await card.getByRole("button", { name: "None of these work" }).click();

    const cancelled = page
      .locator('[data-testid="time-picker-cancelled"]')
      .first();
    await expect(cancelled).toBeVisible({ timeout: 10_000 });
    await expect(cancelled).toContainText("Cancelled");

    // The LAST bubble, not the first: the first is the pre-pause "let me check
    // available times" text, which is on screen before the resume happens, so
    // asserting on it passes even when the resume never lands.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').last(),
    ).toBeVisible({
      timeout: 45_000,
    });

    // Regression (cancel-path narration): a cancel resumes with the SAME
    // toolCallId as a pick, so before the cancelled leg was gated on the tool
    // result the resume replayed the booking confirmation after the user had
    // declined.
    const narration = page
      .locator('[data-testid="copilot-assistant-message"]')
      .last();
    await expect(narration).toContainText("Denied", { timeout: 45_000 });
    await expect(narration).not.toContainText("Booked:");
    await expect(narration).not.toContainText("Scheduled:");
  });
});
