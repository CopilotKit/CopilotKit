import { test, expect } from "@playwright/test";

// E2E for the prebuilt-sidebar demo — exercises the canonical suggestion
// pill registered by `useConfigureSuggestions` in page.tsx.

test.describe("Prebuilt Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("page loads with the sidebar visible", async ({ page }) => {
    await expect(
      page.locator('[data-testid="copilot-sidebar"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Sidebar hello/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-sidebar"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
