import { test, expect } from "@playwright/test";

test.describe("Voice demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/voice");
  });

  test("page loads with chat input and mic button", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
