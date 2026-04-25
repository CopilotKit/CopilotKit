import { test, expect } from "@playwright/test";

test.describe("Headless Complete", () => {
  test("page loads with custom chrome and composer", async ({ page }) => {
    await page.goto("/demos/headless-complete");
    await expect(
      page.getByRole("heading", { name: /Headless Chat \(Complete\)/i }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(/Type a message/i)).toBeVisible();
    await expect(
      page.locator('[data-testid="headless-complete-messages"]'),
    ).toBeVisible();
  });

  test("empty state hint is visible on first load", async ({ page }) => {
    await page.goto("/demos/headless-complete");
    await expect(
      page.getByText(/Try weather, a stock, or a highlighted note/i),
    ).toBeVisible();
  });
});
