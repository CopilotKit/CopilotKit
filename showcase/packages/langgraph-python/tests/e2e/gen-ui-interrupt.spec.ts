import { test, expect } from "@playwright/test";

// QA reference: qa/gen-ui-interrupt.md
// Demo source: src/app/demos/gen-ui-interrupt/{page.tsx, time-picker-card.tsx}
//
// Uses `useInterrupt({ renderInChat: true })` — the low-level CopilotKit
// primitive wired to LangGraph's `interrupt()` on the `interrupt_agent`
// graph (shared with `interrupt-headless`). When the agent invokes the
// backend `schedule_meeting` tool, the graph interrupts and a
// `TimePickerCard` renders INLINE in the chat transcript (no portal).
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
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-interrupt");
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

  // SKIP: `schedule_meeting` is a backend tool on the `interrupt_agent` graph
  // that triggers a LangGraph `interrupt()`. On Railway
  // (`showcase-langgraph-python-production.up.railway.app`) the graph does
  // not reliably reach the interrupt within 60s of a typed prompt, so the
  // inline `time-picker-card` never renders. See W8-6 for details. Un-skip
  // when the interrupt-agent deployment is fixed.
  test.skip("picking a slot transitions the card to the picked state", async ({
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

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45_000,
    });
  });

  // SKIP: same root cause as the picking-a-slot path — see W8-6.
  test.skip("cancel path: None-of-these-work transitions to cancelled state", async ({
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

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45_000,
    });
  });
});
