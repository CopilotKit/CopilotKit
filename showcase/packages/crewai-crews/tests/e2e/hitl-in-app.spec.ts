import { test, expect } from "@playwright/test";

test.describe("In-App HITL", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
  });

  test("tickets panel and chat render", async ({ page }) => {
    await expect(page.getByText("Support Inbox")).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });
});
