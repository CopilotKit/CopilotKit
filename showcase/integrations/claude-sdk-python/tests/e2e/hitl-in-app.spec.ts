import { test, expect } from "@playwright/test";

test.describe("HITL In-App", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("page loads with ticket list and chat", async ({ page }) => {
    await expect(page.getByText("Open tickets")).toBeVisible();
    await expect(page.getByTestId("ticket-12345")).toBeVisible();
  });

  test("chat input is reachable", async ({ page }) => {
    await expect(
      page.locator('textarea, [placeholder*="message"]').first(),
    ).toBeVisible({ timeout: 10000 });
  });

  test("Refund approval suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Refund approval/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
