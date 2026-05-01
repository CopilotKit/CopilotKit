import { test, expect } from "@playwright/test";

test.describe("Gen Ui Interrupt", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-interrupt");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — single pill wired via useConfigureSuggestions.
  // Title + message come from showcase/aimock/_canonical-catalog.json.
  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Pause and pick/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator("[data-testid=\"time-picker-card\"]").first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
