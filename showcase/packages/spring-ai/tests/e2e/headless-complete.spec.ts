import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test("page loads with heading", async ({ page }) => {
    await page.goto("/demos/headless-complete");
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Complete)" }),
    ).toBeVisible();
  });
});
