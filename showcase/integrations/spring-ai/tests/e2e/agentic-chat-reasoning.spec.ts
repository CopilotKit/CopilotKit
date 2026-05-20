import { test, expect } from "@playwright/test";

test.describe("Agentic Chat (Reasoning)", () => {
  test("page loads with chat", async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
