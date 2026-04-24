import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("context card renders with controls", async ({ page }) => {
    await expect(
      page.locator('[data-testid="context-card"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="ctx-name"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="ctx-timezone"]'),
    ).toBeVisible();
  });
});
