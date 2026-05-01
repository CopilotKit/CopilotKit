import { test, expect } from "@playwright/test";

test.describe("Tool Rendering (Custom Catch-all)", () => {
  test("page loads with chat input", async ({ page }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
    await expect(page.getByPlaceholder(/Type a message/)).toBeVisible();
  });

  // Canonical e2e suggestion — single "Custom catchall" pill from
  // _canonical-catalog.json. Selector falls back to [data-role="assistant"]
  // (ag2 spec convention) instead of the catalog's custom-catchall-card.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/tool-rendering-custom-catchall");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Custom catchall" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });
});
