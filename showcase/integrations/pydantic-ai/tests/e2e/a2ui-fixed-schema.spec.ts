import { test, expect } from "@playwright/test";

test.describe("A2UI — Fixed Schema", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
  });

  test("chat UI renders", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
