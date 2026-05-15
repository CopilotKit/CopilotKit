import { test, expect } from "@playwright/test";

test.describe("BYOC json-render", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-json-render");
  });

  test("page loads with chat input and suggestion pills", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(page.getByText("Sales dashboard")).toBeVisible();
    await expect(page.getByText("Revenue by category")).toBeVisible();
    await expect(page.getByText("Expense trend")).toBeVisible();
  });
});
