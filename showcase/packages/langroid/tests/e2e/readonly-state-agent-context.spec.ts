import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("context card renders with default fields", async ({ page }) => {
    await expect(page.locator('[data-testid="context-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-name"]')).toHaveValue("Atai");
  });

  test("published context JSON reflects initial state", async ({ page }) => {
    const json = page.locator('[data-testid="ctx-state-json"]');
    await expect(json).toContainText("Atai");
    await expect(json).toContainText("America/Los_Angeles");
  });

  test("sends a message and gets a reply", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill("What do you know about me?");
    await input.press("Enter");
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });
});
