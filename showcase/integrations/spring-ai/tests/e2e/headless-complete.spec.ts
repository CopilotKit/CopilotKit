import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test("page loads with heading", async ({ page }) => {
    await page.goto("/demos/headless-complete");
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Complete)" }),
    ).toBeVisible();
  });

  // Canonical e2e suggestion — headless demo uses a textarea (no pill UI).
  // Type the canonical catalog message and submit through the Send button.
  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    const textarea = page.locator("textarea").first();
    await textarea.fill("send a sample message to populate the headless transcript");
    await page.getByRole("button", { name: "Send" }).first().click();
    await expect(
      page.locator("[data-testid=\"headless-complete-messages\"]").first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
