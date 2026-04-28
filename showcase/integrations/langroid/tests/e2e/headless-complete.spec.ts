import { test, expect } from "@playwright/test";

test.describe("Headless Chat — Complete (Langroid)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("page loads with hand-rolled header and input", async ({ page }) => {
    await expect(
      page.getByText("Headless Chat (Complete)", { exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Send a message…")).toBeVisible();
  });
});
