import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Default Catch-all)", () => {
  test("page loads with chat input", async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
