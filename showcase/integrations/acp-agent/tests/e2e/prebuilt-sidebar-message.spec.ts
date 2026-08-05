import { expect, test } from "@playwright/test";

test("prebuilt sidebar returns a response to typed input", async ({ page }) => {
  await page.goto("/demos/prebuilt-sidebar");

  await page.getByPlaceholder("Type a message").fill("Hello");
  await page.locator('[data-testid="copilot-send-button"]').first().click();

  await expect(
    page.locator('[data-testid="copilot-assistant-message"]').first(),
  ).toBeVisible({ timeout: 45_000 });
});
