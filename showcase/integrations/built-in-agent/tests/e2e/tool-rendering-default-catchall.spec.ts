import { test, expect } from "@playwright/test";

// E2E for the tool-rendering-default-catchall demo — exercises the canonical
// suggestion pill registered by `useConfigureSuggestions` in page.tsx.

test.describe("Tool Rendering (Default Catchall)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/tool-rendering-default-catchall");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByRole("textbox").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Default catchall/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    // catalog primarySelector is [data-testid="custom-catchall-card"]; the
    // default-catchall variant uses the package-shipped DefaultToolCallRenderer
    // which doesn't ship that testid in built-in-agent — fall back to
    // [data-role="assistant"].
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
