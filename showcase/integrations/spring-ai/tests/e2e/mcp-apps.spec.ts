import { test, expect } from "@playwright/test";

test.describe("MCP Apps", () => {
  test("page loads with chat", async ({ page }) => {
    await page.goto("/demos/mcp-apps");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
