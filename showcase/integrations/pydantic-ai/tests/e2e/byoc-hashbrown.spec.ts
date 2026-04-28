import { test, expect } from "@playwright/test";

test.describe("BYOC Hashbrown", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/byoc-hashbrown");
  });

  test("page loads with header, composer, and suggestion pills", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "BYOC: Hashbrown" }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(page.getByText("Sales dashboard").first()).toBeVisible();
  });
});
