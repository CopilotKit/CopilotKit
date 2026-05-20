import { test, expect } from "@playwright/test";

test.describe("Frontend Tools (Async)", () => {
  test("page loads with chat input", async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
