import { test, expect } from "@playwright/test";

test.describe("Open-Ended Generative UI (Advanced)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui-advanced");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
