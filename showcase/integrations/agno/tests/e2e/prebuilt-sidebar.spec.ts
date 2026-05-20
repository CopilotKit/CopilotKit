import { test, expect } from "@playwright/test";

test.describe("Pre-Built Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/prebuilt-sidebar");
  });

  test("page loads with heading, main content, and sidebar open by default", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Sidebar demo — click the launcher" }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="copilot-chat-toggle"]').first(),
    ).toBeVisible();
  });

  test('"Say hi" suggestion pill renders and sends on click', async ({
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
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");

    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });

  test("sidebar close toggles aria-hidden and the launcher re-opens it", async ({
    page,
  }) => {
    const sidebar = page.locator('[data-testid="copilot-sidebar"]');

    await expect(sidebar).toHaveAttribute("aria-hidden", "false");

    await page.locator('[data-testid="copilot-close-button"]').first().click();

    await expect(sidebar).toHaveAttribute("aria-hidden", "true", {
      timeout: 10000,
    });

    await page.locator('[data-testid="copilot-chat-toggle"]').first().click();
    await expect(sidebar).toHaveAttribute("aria-hidden", "false", {
      timeout: 10000,
    });

    await expect(page).toHaveURL(/\/demos\/prebuilt-sidebar$/);
  });
});
