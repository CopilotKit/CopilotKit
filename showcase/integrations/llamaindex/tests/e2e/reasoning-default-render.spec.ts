import { test, expect } from "@playwright/test";

test.describe("Reasoning (Default Render)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sends a message and gets an assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Explain briefly: why does ice float?");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45000,
    });
  });
});
