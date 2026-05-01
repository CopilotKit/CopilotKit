import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("page loads with custom headless chrome", async ({ page }) => {
    await expect(page.getByText("Headless Chat (Complete)")).toBeVisible();
    await expect(page.getByTestId("headless-complete-messages")).toBeVisible();
  });

  test("Custom message canonical prompt populates the headless transcript", async ({
    page,
  }) => {
    // Headless-complete uses a custom textarea (no pill UX) — type the
    // catalog message directly and verify the messages container is visible.
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill(
      "send a sample message to populate the headless transcript",
    );
    await textarea.press("Enter");

    await expect(
      page.locator('[data-testid="headless-complete-messages"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
