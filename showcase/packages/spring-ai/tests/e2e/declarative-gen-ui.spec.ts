import { test, expect } from "@playwright/test";

test.describe("Declarative Generative UI", () => {
  test("page loads with chat", async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
