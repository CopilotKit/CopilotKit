import { test, expect } from "@playwright/test";

test.describe("HITL", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("chat input is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Sourcing route suggestion pill renders the select-steps card", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Sourcing route" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="select-steps"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
