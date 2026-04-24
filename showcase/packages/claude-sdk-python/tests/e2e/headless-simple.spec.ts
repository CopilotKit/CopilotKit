import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads with heading and empty message hint", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Simple)" }),
    ).toBeVisible();
    await expect(page.getByText("No messages yet. Say hi!")).toBeVisible();
  });

  test("send button is disabled when input is empty", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
