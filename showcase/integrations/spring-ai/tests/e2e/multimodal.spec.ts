import { test, expect } from "@playwright/test";

test.describe("Multimodal", () => {
  test("page loads with chat", async ({ page }) => {
    await page.goto("/demos/multimodal");
    await expect(page.getByTestId("multimodal-demo-root")).toBeVisible();
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
