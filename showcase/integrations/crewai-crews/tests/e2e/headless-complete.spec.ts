import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Complete)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-complete");
  });

  test("header renders", async ({ page }) => {
    await expect(page.getByText("Headless Chat (Complete)")).toBeVisible();
  });

  test("composer textarea is visible", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message...")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  // Headless demo doesn't render the suggestion pill UX; the catalog
  // message is exercised by typing it into the custom composer textarea.
  test("Custom message catalog prompt renders the headless transcript", async ({
    page,
  }) => {
    const textarea = page.getByPlaceholder("Type a message...");
    await textarea.fill(
      "send a sample message to populate the headless transcript",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(
      page.locator('[data-testid="headless-complete-messages"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
