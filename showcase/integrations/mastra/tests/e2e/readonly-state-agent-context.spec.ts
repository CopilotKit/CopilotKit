import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test("context card renders", async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
    await expect(page.locator('[data-testid="context-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-name"]')).toBeVisible();
  });
});
