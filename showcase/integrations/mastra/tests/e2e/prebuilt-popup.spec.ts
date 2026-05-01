import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test("page loads and popup is visible", async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
    await expect(
      page.getByRole("heading", { name: /Popup demo/i }),
    ).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
    const pill = page.getByRole("button", { name: /Popup hello/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-popup"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
