import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("page loads with header and input", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Complete)" }),
    ).toBeVisible();
    await expect(page.locator("textarea").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    // Headless demo doesn't render suggestion pills — type the canonical
    // catalog message into the textarea to exercise the same flow.
    const textarea = page.locator("textarea").first();
    await textarea.fill(
      "send a sample message to populate the headless transcript",
    );
    await page.getByRole("button", { name: "Send" }).first().click();
    await expect(
      page.locator('[data-testid="headless-complete-messages"]').first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
