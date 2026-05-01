import { test, expect } from "@playwright/test";

test.describe("Readonly State (Agent Context)", () => {
  test("context card renders", async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
    await expect(page.locator('[data-testid="context-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="ctx-name"]')).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
    const pill = page.getByRole("button", { name: /Recall pref/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
