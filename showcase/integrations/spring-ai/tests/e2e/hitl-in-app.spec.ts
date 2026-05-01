import { test, expect } from "@playwright/test";

test.describe("HITL in app", () => {
  test("page loads with ticket cards", async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12346"]')).toBeVisible();
  });

  // Canonical e2e suggestion — single pill wired via useConfigureSuggestions.
  // Title + message come from showcase/aimock/_canonical-catalog.json.
  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Refund approval/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator("[data-testid=\"approval-dialog-overlay\"]").first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
