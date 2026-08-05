import { expect, test } from "@playwright/test";

test("prebuilt sidebar closes and reopens", async ({ page }) => {
  await page.goto("/demos/prebuilt-sidebar");

  const sidebar = page.locator('[data-testid="copilot-sidebar"]');
  await expect(sidebar).toHaveAttribute("aria-hidden", "false");
  await page.evaluate(() => {
    const button = document.querySelector(
      '[data-testid="copilot-close-button"]',
    );
    if (button instanceof HTMLElement) button.click();
  });
  await expect(sidebar).toHaveAttribute("aria-hidden", "true", {
    timeout: 10_000,
  });

  await page.locator('[data-testid="copilot-chat-toggle"]').first().click();
  await expect(sidebar).toHaveAttribute("aria-hidden", "false", {
    timeout: 10_000,
  });
});
