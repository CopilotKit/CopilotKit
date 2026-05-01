import { test, expect } from "@playwright/test";

test.describe("Open Gen UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — single "Open block" pill from
  // _canonical-catalog.json. Clicking it dispatches the canonical message
  // and the open gen-ui activity renderer surfaces an assistant response.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Open block" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });
});
