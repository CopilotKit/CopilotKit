import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test("page loads with context card and chat", async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
    await expect(page.locator('[data-testid="context-card"]')).toBeVisible();
    await expect(
      page.getByPlaceholder("Ask about your context..."),
    ).toBeVisible();
  });
});
