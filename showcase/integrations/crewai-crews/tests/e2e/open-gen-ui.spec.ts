import { test, expect } from "@playwright/test";

test.describe("Open-Ended Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui");
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
