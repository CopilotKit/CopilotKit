import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("page loads with header and input", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Complete)" }),
    ).toBeVisible();
    await expect(page.locator("textarea").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });
});
