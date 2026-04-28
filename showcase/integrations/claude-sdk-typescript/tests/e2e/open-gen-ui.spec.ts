import { test, expect } from "@playwright/test";

test.describe("Open-Ended Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 15000,
    });
  });
});
