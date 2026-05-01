import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("page loads with main content heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Sidebar demo/ }),
    ).toBeVisible();
  });

  test("sidebar is open by default", async ({ page }) => {
    // CopilotSidebar mounts with a chat input when open
    await expect(page.locator("textarea").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Sidebar hello/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(page.locator('[data-testid="copilot-sidebar"]')).toBeVisible({
      timeout: 30_000,
    });
  });
});
