import { test, expect } from "@playwright/test";

test.describe("HITL In-Chat (useHumanInTheLoop)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-chat");
  });

  test("page loads with chat input and suggestions", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("meeting request renders TimePickerCard inline", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Please book an intro call with the sales team");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="time-picker-card"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });
});
