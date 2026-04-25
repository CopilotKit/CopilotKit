import { test, expect } from "@playwright/test";

test.describe("Frontend Tools (Async)", () => {
  test("chat input is visible", async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
