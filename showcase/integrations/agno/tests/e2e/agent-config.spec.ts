import { test, expect } from "@playwright/test";

test.describe("Agent Config", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agent-config");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — single "Personalize tone" pill from
  // _canonical-catalog.json. Clicking it dispatches the canonical message
  // through the forwarded-props provider and surfaces an assistant response.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Personalize tone" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45000,
    });
  });
});
