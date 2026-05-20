import { test, expect } from "@playwright/test";

test.describe("Prebuilt Sidebar", () => {
  test("page loads with main content and sidebar", async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
    await expect(
      page.getByText("Sidebar demo — click the launcher"),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
