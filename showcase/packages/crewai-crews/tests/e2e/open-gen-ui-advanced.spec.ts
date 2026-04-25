import { test, expect } from "@playwright/test";

test.describe("Open-Ended Gen UI (Advanced)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui-advanced");
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
