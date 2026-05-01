import { test, expect } from "@playwright/test";

test.describe("Agent Config (Langroid)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("config card renders with three selects", async ({ page }) => {
    await expect(
      page.locator('[data-testid="agent-config-card"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-tone-select"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-expertise-select"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="agent-config-length-select"]'),
    ).toBeVisible();
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Personalize tone/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="agent-config-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
