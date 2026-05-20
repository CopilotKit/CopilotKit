import { test, expect } from "@playwright/test";

test.describe("Voice", () => {
  test("page loads with sample audio button and chat", async ({ page }) => {
    await page.goto("/demos/voice");
    await expect(page.getByTestId("voice-sample-audio")).toBeVisible();
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
