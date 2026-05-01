import { test, expect } from "@playwright/test";

test.describe("A2UI Fixed Schema", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/a2ui-fixed-schema");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 10000,
    });
  });

  test("Block calendar suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Block calendar/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
