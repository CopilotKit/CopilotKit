import { test, expect } from "@playwright/test";

test.describe("Frontend Tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools");
  });

  test("page loads with chat and background container", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="background-container"]'),
    ).toBeVisible();
  });

  test("background change request updates background style", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Change the background to a blue-to-purple gradient");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 45000,
    });

    const bg = page.locator('[data-testid="background-container"]');
    await expect(bg).not.toHaveCSS("background-color", "rgb(250, 250, 249)", {
      timeout: 15000,
    });
  });
});
