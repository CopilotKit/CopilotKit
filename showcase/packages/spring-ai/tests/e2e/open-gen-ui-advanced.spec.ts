import { test, expect } from "@playwright/test";

test.describe("Open Generative UI (advanced)", () => {
  test("page loads with CopilotChat", async ({ page }) => {
    await page.goto("/demos/open-gen-ui-advanced");
    await expect(
      page.getByTestId("copilot-chat-textarea"),
    ).toBeVisible();
  });
});
