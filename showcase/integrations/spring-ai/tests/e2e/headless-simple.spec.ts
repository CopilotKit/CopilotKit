import { test, expect } from "@playwright/test";

test.describe("Headless Simple", () => {
  test("page loads with heading", async ({ page }) => {
    await page.goto("/demos/headless-simple");
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Simple)" }),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — headless demo uses a textarea (no pill UI).
  // Type the canonical catalog message and submit through the Send button.
  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("show a small card body about hummingbirds");
    await page.getByRole("button", { name: "Send" }).first().click();
    await expect(
      page.locator("[data-message-role=\"assistant\"]").first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
