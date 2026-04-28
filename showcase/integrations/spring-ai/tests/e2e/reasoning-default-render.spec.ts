import { test, expect } from "@playwright/test";

test.describe("Reasoning Default Render", () => {
  test("page loads with chat", async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
