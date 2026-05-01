import { test, expect } from "@playwright/test";

test.describe("Prebuilt Sidebar", () => {
  test("page loads with main content and sidebar", async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
    await expect(
      page.getByText("Sidebar demo — click the launcher"),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("canonical 'Sidebar hello' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    await page.goto("/demos/prebuilt-sidebar");
    const pill = page.getByRole("button", { name: /Sidebar hello/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-sidebar"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
