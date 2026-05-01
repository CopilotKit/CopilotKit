import { test, expect } from "@playwright/test";

test.describe("In-App HITL", () => {
  test("tickets panel and chat both render", async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
    await expect(page.getByText("Open tickets")).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
  });

  // Canonical e2e suggestion — single "Refund approval" pill from
  // _canonical-catalog.json. Triggers the in-app approval modal.
  test("canonical suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    await page.goto("/demos/hitl-in-app");
    const pill = page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Refund approval" })
      .first();
    await expect(pill).toBeVisible({ timeout: 15000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="approval-dialog-overlay"]').first(),
    ).toBeVisible({ timeout: 60000 });
  });
});
