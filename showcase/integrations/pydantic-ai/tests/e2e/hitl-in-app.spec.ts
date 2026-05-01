import { test, expect } from "@playwright/test";

test.describe("HITL In-App", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("page loads with tickets panel", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Open tickets" }),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12346"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12347"]')).toBeVisible();
  });

  test("chat surface renders", async ({ page }) => {
    await expect(page.locator("textarea").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Refund approval/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-user-message"]').first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
