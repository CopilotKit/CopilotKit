import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test("page loads with popup launcher and main content visible", async ({
    page,
  }) => {
    await page.goto("/demos/prebuilt-popup");
    await expect(
      page.getByText("Popup demo — look for the floating launcher"),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — single "Popup hello" pill from
  // _canonical-catalog.json. The popup is wired and reachable.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/prebuilt-popup");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Popup hello" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-popup"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
