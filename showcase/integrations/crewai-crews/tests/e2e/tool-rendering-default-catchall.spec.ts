import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Default Catch-all)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("page renders chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
