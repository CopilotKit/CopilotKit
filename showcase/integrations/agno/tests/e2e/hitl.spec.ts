import { test, expect } from "@playwright/test";

test.describe("HITL", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — single "Sourcing route" pill from
  // _canonical-catalog.json. Clicking it dispatches the canonical message
  // and the HITL flow renders the select-steps card.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Sourcing route" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 60000,
    });
  });
});
