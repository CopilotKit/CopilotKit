import { test, expect } from "@playwright/test";

test.describe("BYOC hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("page loads with header and suggestion pills", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "BYOC: Hashbrown" }),
    ).toBeVisible();
    await expect(page.getByText("Sales dashboard")).toBeVisible();
    await expect(page.getByText("Revenue by category")).toBeVisible();
    await expect(page.getByText("Expense trend")).toBeVisible();
  });
});
