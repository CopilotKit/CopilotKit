import { test, expect } from "@playwright/test";

test.describe("Frontend Tools (Async)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("searching notes via suggestion renders the notes card", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Find project-planning notes" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(page.locator('[data-testid="notes-card"]').first()).toBeVisible(
      { timeout: 45000 },
    );

    await expect(page.locator('[data-testid="notes-keyword"]').first()).toBeVisible();
  });
});
