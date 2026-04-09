import { test, expect } from "@playwright/test";

test.describe("State Streaming", () => {
  test("page loads and chat renders", async ({ page }) => {
    await page.goto("/demos/shared-state-streaming");

    // Chat interface should be visible
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("can send a message and receive a response", async ({ page }) => {
    await page.goto("/demos/shared-state-streaming");

    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    // Wait for agent response (adjust timeout as needed)
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  // TODO: Add feature-specific assertions
});
