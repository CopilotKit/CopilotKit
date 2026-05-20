import { test, expect } from "@playwright/test";

test.describe("Agentic Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Say hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });
});
