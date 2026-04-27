import { test, expect } from "@playwright/test";

test.describe("Prebuilt Sidebar", () => {
  test("page loads", async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
    await expect(
      page.getByRole("heading", { name: "Sidebar demo — click the launcher" }),
    ).toBeVisible();
  });
});
