import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("page loads with context card and chat", async ({ page }) => {
    await expect(page.locator('[data-testid="context-card"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="ctx-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-timezone"]')).toBeVisible();
    await expect(
      page.getByPlaceholder("Ask about your context..."),
    ).toBeVisible();
  });
});
