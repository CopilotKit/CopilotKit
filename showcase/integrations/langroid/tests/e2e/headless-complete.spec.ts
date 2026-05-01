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

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    const input = page.getByPlaceholder("Send a message…").first();
    await input.fill(
      "send a sample message to populate the headless transcript",
    );
    await input.press("Enter");
    await expect(
      page.locator('[data-testid="headless-complete-messages"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
