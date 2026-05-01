import { test, expect } from "@playwright/test";

test.describe("Reasoning (Default Render)", () => {
  test("page loads chat input", async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
    await expect(page.getByPlaceholder(/Type a message/)).toBeVisible();
  });

  // Canonical e2e suggestion — single "Default reasoning" pill from
  // _canonical-catalog.json. Selector falls back to [data-role="assistant"]
  // (ag2 spec convention) instead of the catalog's reasoning-message.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/reasoning-default-render");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Default reasoning" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });
});
