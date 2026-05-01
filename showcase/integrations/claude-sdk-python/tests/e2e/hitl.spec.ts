import { test, expect } from "@playwright/test";

test.describe("HITL", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Sourcing route suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Sourcing route/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="select-steps"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
