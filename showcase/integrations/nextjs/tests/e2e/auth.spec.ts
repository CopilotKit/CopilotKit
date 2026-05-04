import { test, expect } from "@playwright/test";
import { frameworksSupportingDemo } from "../helpers/parity";

const DEMO = "auth";

for (const fw of frameworksSupportingDemo(DEMO)) {
  test.describe(`${fw} × ${DEMO}`, () => {
    test("page renders auth banner in signed-in state", async ({ page }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      const banner = page.locator('[data-testid="auth-banner"]');
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(banner).toHaveAttribute("data-authenticated", "true");
    });

    test("sign out shows unauthenticated state", async ({ page }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      await expect(
        page.locator('[data-testid="auth-banner"]'),
      ).toBeVisible({ timeout: 15_000 });
      await page.click('[data-testid="auth-sign-out-button"]');
      await expect(
        page.locator('[data-testid="auth-banner"]'),
      ).toHaveAttribute("data-authenticated", "false");
    });

    test("sign in after sign out restores authenticated state", async ({
      page,
    }) => {
      await page.goto(`/demos/${fw}/${DEMO}`);
      await expect(
        page.locator('[data-testid="auth-banner"]'),
      ).toBeVisible({ timeout: 15_000 });
      await page.click('[data-testid="auth-sign-out-button"]');
      await page.click('[data-testid="auth-authenticate-button"]');
      await expect(
        page.locator('[data-testid="auth-banner"]'),
      ).toHaveAttribute("data-authenticated", "true");
    });
  });
}
