import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test("page loads with hand-rolled header and input", async ({ page }) => {
    await page.goto("/demos/headless-complete");
    await expect(page.getByText("Headless Chat (Complete)")).toBeVisible();
    await expect(page.getByPlaceholder("Type a message...")).toBeVisible();
  });
});
