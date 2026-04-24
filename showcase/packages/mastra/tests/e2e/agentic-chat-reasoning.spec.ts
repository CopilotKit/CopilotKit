import { test, expect } from "@playwright/test";

test.describe("Agentic Chat (Reasoning)", () => {
  test("chat input is visible", async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
