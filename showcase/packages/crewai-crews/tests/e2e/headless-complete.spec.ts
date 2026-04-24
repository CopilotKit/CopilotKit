import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("header renders", async ({ page }) => {
    await expect(page.getByText("Headless Chat (Complete)")).toBeVisible();
  });

  test("composer textarea is visible", async ({ page }) => {
    await expect(
      page.getByPlaceholder("Type a message..."),
    ).toBeVisible();
  });
});
