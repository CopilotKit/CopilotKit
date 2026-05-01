import { test, expect } from "@playwright/test";

test.describe("MCP Apps", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/mcp-apps");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Excalidraw/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
