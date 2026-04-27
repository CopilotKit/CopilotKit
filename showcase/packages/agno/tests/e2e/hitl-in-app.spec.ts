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

  test("clicking refund pill opens approval dialog outside the chat", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: "Approve refund for #12345" })
      .first()
      .click();

    await expect(
      page.locator('[data-testid="approval-dialog"]').first(),
    ).toBeVisible({ timeout: 45000 });

    await expect(
      page.locator('[data-testid="approval-dialog-approve"]').first(),
    ).toBeVisible();
  });
});
