import { test, expect } from "@playwright/test";

test.describe("HITL In-App", () => {
  test("tickets panel renders", async ({ page }) => {
    await page.goto("/demos/hitl-in-app");
    await expect(
      page.getByRole("heading", { name: /Open tickets/i }),
    ).toBeVisible();
    await expect(page.locator('[data-testid="ticket-12345"]')).toBeVisible();
  });
});
