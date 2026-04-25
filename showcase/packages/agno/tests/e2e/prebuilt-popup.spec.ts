import { test, expect } from "@playwright/test";

test.describe("Pre-Built Popup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-popup");
  });

  test("page loads with heading and the popup open by default", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", {
        name: "Popup demo — look for the floating launcher",
      }),
    ).toBeVisible();

    await expect(
      page.getByPlaceholder("Ask the popup anything..."),
    ).toBeVisible();

    await expect(
      page.locator('[data-testid="copilot-chat-toggle"]').first(),
    ).toBeVisible();
  });

  test('"Say hi" suggestion pill renders and produces an assistant response', async ({
    page,
  }) => {
    const sayHiPill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Say hi" })
      .first();
    await expect(sayHiPill).toBeVisible({ timeout: 15000 });

    await sayHiPill.click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("typing a message and clicking send produces an assistant response", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Ask the popup anything...");
    await input.fill("Hello");

    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("popup close button hides the popup; launcher re-mounts it", async ({
    page,
  }) => {
    const popup = page.locator('[data-testid="copilot-popup"]');
    await expect(popup).toBeVisible();

    await page.locator('[data-testid="copilot-close-button"]').first().click();
    await expect(popup).toBeHidden({ timeout: 10000 });

    await page.locator('[data-testid="copilot-chat-toggle"]').first().click();
    await expect(popup).toBeVisible({ timeout: 10000 });

    await expect(page).toHaveURL(/\/demos\/prebuilt-popup$/);
  });
});
