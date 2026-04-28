import { test, expect } from "@playwright/test";

test.describe("Reasoning Default Render (testing)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
  });

  test("page renders without errors", async ({ page }) => {
    // Default CopilotChat input is the most stable structural element —
    // this cell uses no custom slots, so the stock CopilotChat testids
    // are the clearest on-load signal.
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible();
  });
});
