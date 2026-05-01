import { test, expect } from "@playwright/test";

test.describe("BYOC hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("page loads with header and suggestion pills", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "BYOC: Hashbrown" }),
    ).toBeVisible();
    await expect(page.getByText("Sales overview")).toBeVisible();
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Sales overview/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="metric-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
