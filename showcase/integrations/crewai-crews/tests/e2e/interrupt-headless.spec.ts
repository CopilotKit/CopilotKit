import { test, expect } from "@playwright/test";

test.describe("Headless Interrupt", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/interrupt-headless");
  });

  test("app surface and chat are visible", async ({ page }) => {
    await expect(
      page.locator('[data-testid="interrupt-headless-app-surface"]'),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  test("Headless interrupt suggestion pill renders an assistant message", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Headless interrupt" })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
