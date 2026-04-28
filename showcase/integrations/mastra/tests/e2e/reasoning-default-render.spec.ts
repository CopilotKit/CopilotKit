import { test, expect } from "@playwright/test";

test.describe("Reasoning (Default Render)", () => {
  test("chat input is visible", async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
