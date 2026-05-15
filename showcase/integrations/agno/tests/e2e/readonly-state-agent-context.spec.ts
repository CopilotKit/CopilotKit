import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("context card and JSON preview render", async ({ page }) => {
    await expect(page.locator('[data-testid="context-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-state-json"]')).toBeVisible();
  });

  test("changing the name input updates the JSON preview", async ({ page }) => {
    const name = page.locator('[data-testid="ctx-name"]');
    await name.fill("Alice");

    const json = page.locator('[data-testid="ctx-state-json"]');
    await expect(json).toContainText('"name": "Alice"');
  });

  test("changing the timezone updates the JSON preview", async ({ page }) => {
    const tz = page.locator('[data-testid="ctx-timezone"]');
    await tz.selectOption("Europe/London");

    const json = page.locator('[data-testid="ctx-state-json"]');
    await expect(json).toContainText("Europe/London");
  });
});
