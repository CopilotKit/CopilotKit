import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test("page loads with hand-rolled textarea", async ({ page }) => {
    await page.goto("/demos/headless-simple");
    await expect(
      page.getByPlaceholder(/Type a message. Ask me/),
    ).toBeVisible();
  });
});
