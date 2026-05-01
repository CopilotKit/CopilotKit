import { test, expect } from "@playwright/test";

// E2E for the auth demo — exercises the canonical suggestion pill registered
// by `useConfigureSuggestions` in page.tsx.

test.describe("Auth", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Auth check/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="auth-banner"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
