import { test, expect } from "@playwright/test";

test.describe("In-App HITL", () => {
  test("tickets panel and chat both render", async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
    await expect(page.getByText("Open tickets")).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
  });
});
