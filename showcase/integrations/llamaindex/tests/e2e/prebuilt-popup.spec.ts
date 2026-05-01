import { test, expect } from "@playwright/test";

test.describe("Prebuilt Popup", () => {
  test("page loads with main content and popup launcher", async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
    await expect(
      page.getByText("Popup demo — look for the floating launcher"),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible();
  });

  test("canonical 'Popup hello' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    await page.goto("/demos/prebuilt-popup");
    const pill = page.getByRole("button", { name: /Popup hello/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-popup"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
