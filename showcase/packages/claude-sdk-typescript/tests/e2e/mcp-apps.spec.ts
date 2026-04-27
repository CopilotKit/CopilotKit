import { test, expect } from "@playwright/test";

test.describe("MCP Apps", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/mcp-apps");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 15000,
    });
  });
});
