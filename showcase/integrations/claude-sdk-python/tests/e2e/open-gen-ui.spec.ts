import { test, expect } from "@playwright/test";

test.describe("Open-Ended Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/open-gen-ui");
  });

  test("chat input is reachable", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Open block suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Open block/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="copilot-suggestion"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
