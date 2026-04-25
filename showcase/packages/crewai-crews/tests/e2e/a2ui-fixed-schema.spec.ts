import { test, expect } from "@playwright/test";

test.describe("A2UI Fixed-Schema", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
  });

  test("demo-root renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="a2ui-fixed-schema-root"]'),
    ).toBeVisible();
  });
});
