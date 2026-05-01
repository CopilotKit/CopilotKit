import { test, expect } from "@playwright/test";

test.describe("HITL In-App", () => {
  test("tickets panel renders", async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
    await expect(
      page.getByRole("heading", { name: /Open tickets/i }),
    ).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
    const pill = page.getByRole("button", { name: /Refund approval/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
