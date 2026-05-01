import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Default Catchall)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Default catchall/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="custom-catchall-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
