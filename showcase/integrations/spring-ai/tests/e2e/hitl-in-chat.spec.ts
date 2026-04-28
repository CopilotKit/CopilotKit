import { test, expect } from "@playwright/test";

test.describe("In-Chat HITL", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-chat");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(
      page.locator(".copilotKitAssistantMessage").first(),
    ).toBeVisible({
      timeout: 30000,
    });
  });
});
