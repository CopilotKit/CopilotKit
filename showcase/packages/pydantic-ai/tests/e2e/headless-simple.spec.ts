import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads with heading and input", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Simple)" }),
    ).toBeVisible();
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("send button is present", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });
});
