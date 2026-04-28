import { test, expect } from "@playwright/test";

test.describe("Headless Simple", () => {
  test("page loads with heading", async ({ page }) => {
    await page.goto("/demos/headless-simple");
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Simple)" }),
    ).toBeVisible();
  });
});
