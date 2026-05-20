import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Reasoning Chain)", () => {
  test("page loads with chat", async ({ page }) => {
    await page.goto("/demos/tool-rendering-reasoning-chain");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
