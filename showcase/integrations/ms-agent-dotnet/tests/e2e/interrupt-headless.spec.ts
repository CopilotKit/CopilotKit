import { test, expect } from "@playwright/test";

test.describe("Interrupt Headless", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/interrupt-headless");
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page
      .getByRole("button", { name: /Headless interrupt/i })
      .first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-message-role="assistant"]').first().or(
        page.locator('[data-role="assistant"]').first(),
      ),
    ).toBeVisible({ timeout: 60_000 });
  });
});
