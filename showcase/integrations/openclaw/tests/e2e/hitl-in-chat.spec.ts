import { test, expect } from "@playwright/test";

// Behavioral e2e for the hitl-in-chat demo (OpenClaw), run against aimock.
//
// The demo registers a human-in-the-loop tool via `useHumanInTheLoop`:
// `book_call(topic, attendee)`. Its render() paints an in-chat
// <TimePickerCard> (data-testid="time-picker-card") with selectable slots
// (data-testid="time-picker-slot"). OpenClaw does a multi-call loop: call #1
// (hasToolResult: false) emits the book_call toolCall → the picker renders;
// after the user picks a slot the tool result flows back and call #2
// (hasToolResult: true) returns a text confirmation. Picking a slot swaps the
// card to data-testid="time-picker-picked". Prompts match
// showcase/aimock/d4/openclaw/chat.json.
test.describe("HITL in chat — booking flow", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-chat");
  });

  test("page loads with chat input and both booking suggestions", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20000,
    });
    for (const title of [
      "Book a call with sales",
      "Schedule a 1:1 with Alice",
    ]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("'Schedule a 1:1 with Alice' renders the time-picker card", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Schedule a 1:1 with Alice next week to review Q2 goals.");
    await input.press("Enter");

    const card = page.locator('[data-testid="time-picker-card"]');
    await expect(card).toBeVisible({ timeout: 60000 });

    // The fixture toolCall passes attendee "Alice"; the card advertises it.
    await expect(
      card.locator("p").filter({ hasText: /^With Alice$/i }),
    ).toBeVisible();

    const slots = page.locator('[data-testid="time-picker-slot"]');
    expect(await slots.count()).toBeGreaterThan(0);
  });

  test("picking a time slot resolves the HITL and shows a confirmation", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Schedule a 1:1 with Alice next week to review Q2 goals.");
    await input.press("Enter");

    const slot = page.locator('[data-testid="time-picker-slot"]').first();
    await expect(slot).toBeVisible({ timeout: 60000 });
    await slot.click();

    // The picked-state card replaces the slot grid.
    await expect(
      page.locator('[data-testid="time-picker-picked"]'),
    ).toBeVisible({ timeout: 10000 });

    // Call #2 (hasToolResult: true) returns the booking confirmation text.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
