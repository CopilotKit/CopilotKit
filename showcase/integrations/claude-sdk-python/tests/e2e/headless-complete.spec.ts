import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("page loads with custom headless chrome", async ({ page }) => {
    await expect(page.getByText("Headless Chat (Complete)")).toBeVisible();
    await expect(page.getByTestId("headless-complete-messages")).toBeVisible();
  });
});
