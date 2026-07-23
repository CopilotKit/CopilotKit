import { test, expect } from "@playwright/test";

test.describe("BYOC: Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("demo-root renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="byoc-hashbrown-root"]'),
    ).toBeVisible();
  });
});
