import { test, expect } from "@playwright/test";

test.describe("HITL In-App", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("page loads with tickets panel and chat", async ({ page }) => {
    await expect(page.getByText("Open tickets")).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("approval request opens modal dialog", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Please approve a $50 refund for ticket #12345");
    await input.press("Enter");

    await expect(page.locator('[data-testid="approval-dialog"]')).toBeVisible({
      timeout: 45000,
    });
  });
});
