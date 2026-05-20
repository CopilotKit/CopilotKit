import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Custom Catchall)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
  });

  test("page loads with chat", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
