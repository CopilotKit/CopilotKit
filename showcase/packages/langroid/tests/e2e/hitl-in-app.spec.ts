import { test, expect } from "@playwright/test";

test.describe("HITL In-App", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("tickets panel renders sample tickets", async ({ page }) => {
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12346"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12347"]')).toBeVisible();
  });

  test("approval request opens dialog outside chat", async ({ page }) => {
    const input = page.locator('textarea, [placeholder*="message"]').first();
    await input.fill(
      "Please approve a $50 refund to Jordan Rivera on ticket #12345.",
    );
    await input.press("Enter");
    await expect(page.locator('[data-testid="approval-dialog"]')).toBeVisible({
      timeout: 60000,
    });
    await page.locator('[data-testid="approval-dialog-approve"]').click();
    await expect(
      page.locator('[data-testid="approval-dialog"]'),
    ).not.toBeVisible();
  });
});
