import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("page loads with main content and sidebar chat", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /sidebar demo/i }),
    ).toBeVisible();
    // CopilotSidebar is open by default — input should be visible.
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 15000,
    });
  });
});
