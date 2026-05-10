/**
 * E2E spec for the byoc-hashbrown demo.
 *
 * Authored but not executed pre-deploy — Railway stabilization runs happen
 * post-deploy per the plan's scope modification. Selectors match the ported
 * chart/metric components' `data-testid` hooks.
 *
 * Covers 3 suggestion flows + page-load smoke. Assertion timeouts favor
 * streaming-friendly budgets because hashbrown assembles UI progressively
 * from structured output.
 */
import { test, expect } from "@playwright/test";

test.describe("BYOC Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("page loads with header, suggestion pills, and chat composer", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "BYOC: Hashbrown" }),
    ).toBeVisible();
    await expect(page.getByText("Sales dashboard").first()).toBeVisible();
    await expect(page.getByText("Revenue by category").first()).toBeVisible();
    await expect(page.getByText("Expense trend").first()).toBeVisible();
  });

  test("sales-dashboard suggestion triggers a hashbrown render", async ({
    page,
  }) => {
    await page.getByText("Sales dashboard").first().click();

    const metricCard = page.locator('[data-testid="metric-card"]').first();
    const chart = page
      .locator('[data-testid="bar-chart"], [data-testid="pie-chart"]')
      .first();

    await expect(metricCard).toBeVisible({ timeout: 60000 });
    await expect(chart).toBeVisible({ timeout: 60000 });
  });

  test("revenue-by-category suggestion renders a pie chart", async ({
    page,
  }) => {
    await page.getByText("Revenue by category").first().click();
    await expect(page.locator('[data-testid="pie-chart"]').first()).toBeVisible(
      { timeout: 60000 },
    );
  });

  test("expense-trend suggestion renders a bar chart", async ({ page }) => {
    await page.getByText("Expense trend").first().click();
    await expect(page.locator('[data-testid="bar-chart"]').first()).toBeVisible(
      { timeout: 60000 },
    );
  });
});
