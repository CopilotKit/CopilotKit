import { test, expect } from "@playwright/test";

// E2E for the multimodal demo — exercises the canonical suggestion pill
// registered by `useConfigureSuggestions` in page.tsx.

test.describe("Multimodal", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/multimodal");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Sample image/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
