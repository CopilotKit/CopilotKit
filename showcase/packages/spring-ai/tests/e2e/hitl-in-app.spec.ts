import { test, expect } from "@playwright/test";

test.describe("HITL in app", () => {
  test("page loads with ticket cards", async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12346"]')).toBeVisible();
  });
});
