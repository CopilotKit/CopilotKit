import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test("page loads and sidebar is visible", async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
    await expect(
      page.getByRole("heading", { name: /Sidebar demo/i }),
    ).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
    const pill = page.getByRole("button", { name: /Sidebar hello/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-sidebar"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
