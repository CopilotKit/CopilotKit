import { test, expect } from "@playwright/test";

// E2E for the a2ui-fixed-schema demo. Scope: load the page and exercise the
// canonical suggestion pill registered by `useConfigureSuggestions` in
// page.tsx. The pill matches the entry in showcase/aimock/_canonical-catalog.json,
// so a single click drives the feature deterministically against aimock.

test.describe("A2UI Fixed Schema", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Block calendar/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
