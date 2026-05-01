import { test, expect } from "@playwright/test";

// E2E for the prebuilt-popup demo — exercises the canonical suggestion pill
// registered by `useConfigureSuggestions` in page.tsx.

test.describe("Prebuilt Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("page loads with the popup visible", async ({ page }) => {
    await expect(
      page.locator('[data-testid="copilot-popup"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Popup hello/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-popup"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
