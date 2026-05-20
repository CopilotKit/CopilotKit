import { test, expect } from "@playwright/test";

test.describe("A2UI Fixed Schema", () => {
  test("page loads with CopilotChat", async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
    await expect(page.getByTestId("copilot-chat-textarea")).toBeVisible();
  });
});
