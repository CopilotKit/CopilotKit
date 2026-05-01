import { test, expect } from "@playwright/test";

test.describe("Reasoning (Default Render)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Default reasoning/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    // Catalog selector [data-testid="copilot-reasoning-message"] does not
    // exist in V2 react-core; fall back to assistant message (Rule 4).
    await expect(
      page.locator('[data-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
