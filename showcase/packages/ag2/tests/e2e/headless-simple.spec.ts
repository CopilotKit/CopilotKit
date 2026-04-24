import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test("custom headless UI loads", async ({ page }) => {
    await page.goto("/demos/headless-simple");
    await expect(page.getByText("Headless Chat (Simple)")).toBeVisible();
    await expect(page.getByPlaceholder(/Type a message/)).toBeVisible();
  });
});
