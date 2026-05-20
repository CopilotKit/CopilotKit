import { test, expect } from "@playwright/test";

test.describe("Open Generative UI (minimal)", () => {
  test("page loads with CopilotChat", async ({ page }) => {
    await page.goto("/demos/open-gen-ui");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
