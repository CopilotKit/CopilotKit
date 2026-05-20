import { test, expect } from "@playwright/test";

test.describe("In-App Human-in-the-Loop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 15000,
    });
  });
});
