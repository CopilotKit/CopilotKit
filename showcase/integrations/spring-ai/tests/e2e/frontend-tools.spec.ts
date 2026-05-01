import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test("page loads with background container", async ({ page }) => {
    await page.goto("/demos/frontend-tools");
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — single pill wired via useConfigureSuggestions.
  // Title + message come from showcase/aimock/_canonical-catalog.json.
  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Switch theme/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="background-container"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
