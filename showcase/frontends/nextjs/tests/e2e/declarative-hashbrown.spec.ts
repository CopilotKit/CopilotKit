import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// Declarative UI: Hashbrown. The selectors are the `data-testid` hooks of the
// chart and metric components. hashbrown builds the UI while the structured
// output streams in, so render timeouts are long.
describeDemo("declarative-hashbrown", "Declarative UI: Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("declarative-hashbrown"));
  });

  test("page loads with header, suggestion pills, and chat composer", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "Declarative UI: Hashbrown" }),
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
