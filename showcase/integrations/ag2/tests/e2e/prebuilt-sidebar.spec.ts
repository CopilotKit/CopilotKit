import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test("page loads with sidebar open and main content visible", async ({
    page,
  }) => {
    await page.goto("/demos/prebuilt-sidebar");
    await expect(
      page.getByText("Sidebar demo — click the launcher"),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — single "Sidebar hello" pill from
  // _canonical-catalog.json. The sidebar is wired and reachable.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/prebuilt-sidebar");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Sidebar hello" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-sidebar"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
