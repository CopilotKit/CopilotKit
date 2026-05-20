import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("main content heading renders", async ({ page }) => {
    await expect(
      page.getByText("Sidebar demo — click the launcher"),
    ).toBeVisible();
  });

  test("sidebar is open by default and shows chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
