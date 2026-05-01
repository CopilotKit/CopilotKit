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
    // Catalog selector [data-testid="custom-catchall-card"] not present in
    // this demo (uses default renderer); fall back to assistant (Rule 4).
    await expect(
      page.locator('[data-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
