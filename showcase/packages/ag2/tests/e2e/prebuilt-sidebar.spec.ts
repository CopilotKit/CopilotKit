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
});
