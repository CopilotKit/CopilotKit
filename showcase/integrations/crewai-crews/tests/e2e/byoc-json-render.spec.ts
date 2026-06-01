import { test, expect } from "@playwright/test";

test.describe("BYOC: json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("demo-root renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="byoc-json-render-root"]'),
    ).toBeVisible();
  });
});
