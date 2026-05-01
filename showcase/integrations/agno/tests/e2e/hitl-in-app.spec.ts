import { test, expect } from "@playwright/test";

test.describe("In-App HITL", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("support inbox tickets and chat render on load", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Open tickets" }),
    ).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12346"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12347"]')).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  // Canonical e2e suggestion — single "Refund approval" pill from
  // _canonical-catalog.json. Clicking it must surface the in-app approval
  // dialog overlay (the primary observable for this demo).
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Refund approval" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]').first(),
    ).toBeVisible({ timeout: 45000 });
  });
});
