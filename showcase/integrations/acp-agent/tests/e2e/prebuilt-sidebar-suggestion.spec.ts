import { expect, test } from "@playwright/test";

test("prebuilt sidebar sends its suggestion", async ({ page }) => {
  await page.goto("/demos/prebuilt-sidebar");

  const suggestion = page
    .locator('[data-testid="copilot-suggestion"]')
    .filter({ hasText: "Say hi" })
    .first();
  await expect(suggestion).toBeVisible({ timeout: 15_000 });
  await suggestion.click();

  await expect(
    page.locator('[data-testid="copilot-assistant-message"]').first(),
  ).toBeVisible({ timeout: 45_000 });
});
