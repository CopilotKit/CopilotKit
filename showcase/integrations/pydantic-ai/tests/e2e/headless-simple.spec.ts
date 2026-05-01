import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads with heading and input", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Simple)" }),
    ).toBeVisible();
    await expect(page.locator("textarea").first()).toBeVisible();
  });

  test("send button is present", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    // Headless-simple uses a textarea and no suggestion pills — type the
    // canonical catalog message and submit through the custom Send button.
    const textarea = page.locator("textarea").first();
    await textarea.fill("show a small card body about hummingbirds");
    await page.getByRole("button", { name: "Send" }).first().click();
    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
