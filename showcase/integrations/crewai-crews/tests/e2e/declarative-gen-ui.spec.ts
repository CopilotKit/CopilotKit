import { test, expect } from "@playwright/test";

test.describe("Declarative Generative UI (A2UI - Dynamic Schema)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/declarative-gen-ui");
  });

  test("demo-root renders", async ({ page }) => {
    await expect(
      page.locator('[data-testid="declarative-gen-ui-root"]'),
    ).toBeVisible();
  });
});
