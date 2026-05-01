import { test, expect } from "@playwright/test";

test.describe("Interrupt Headless", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/interrupt-headless");
  });

  test("page loads with chat input and app surface", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="interrupt-headless-app-surface"]'),
    ).toBeVisible();
  });

  test("canonical 'Headless interrupt' suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
    const pill = page
      .getByRole("button", { name: /Headless interrupt/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page
        .locator('[data-message-role="assistant"], [data-role="assistant"]')
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
