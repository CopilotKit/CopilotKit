import { test, expect } from "@playwright/test";

test.describe("Human in the Loop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("meeting request shows time slot picker", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Schedule a meeting to discuss the project roadmap");
    await input.press("Enter");

    // MeetingTimePicker renders time slot buttons with AM/PM times
    const timeSlotButton = page.locator(
      'button:has-text("AM"), button:has-text("PM")',
    );
    await expect(timeSlotButton.first()).toBeVisible({ timeout: 60000 });
  });

  test("clicking a time slot confirms the meeting", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Schedule a 30 minute meeting for a team sync");
    await input.press("Enter");

    // Wait for time slot buttons to appear
    const timeSlotButton = page.locator(
      'button:has-text("AM"), button:has-text("PM")',
    );
    await expect(timeSlotButton.first()).toBeVisible({ timeout: 60000 });

    // Click the first available time slot
    await timeSlotButton.first().click();

    // After selecting, the confirmed state shows "Meeting Scheduled"
    await expect(page.getByText("Meeting Scheduled")).toBeVisible({
      timeout: 10000,
    });
  });

  test("decline button is available for time slots", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Set up a meeting about quarterly planning");
    await input.press("Enter");

    // Wait for the time slot picker to appear
    const timeSlotButton = page.locator(
      'button:has-text("AM"), button:has-text("PM")',
    );
    await expect(timeSlotButton.first()).toBeVisible({ timeout: 60000 });

    // The decline button reads "None of these work"
    const declineBtn = page.getByText("None of these work");
    await expect(declineBtn).toBeVisible({ timeout: 5000 });

    await declineBtn.click();

    // After declining, shows "No Time Selected"
    await expect(page.getByText("No Time Selected")).toBeVisible({
      timeout: 10000,
    });
  });
});
