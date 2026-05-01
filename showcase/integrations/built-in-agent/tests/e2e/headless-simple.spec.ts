import { test, expect } from "@playwright/test";

// E2E for the headless-simple demo. Like headless-complete, this surface uses
// a hand-rolled textarea + Send button — no suggestion pills. The canonical
// e2e fills the textarea with the catalog message and clicks Send.

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads with hand-rolled composer", async ({ page }) => {
    await expect(
      page.getByPlaceholder(
        "Type a message. Ask me to 'show a card about cats'.",
      ),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("canonical suggestion prompt fires the feature", async ({ page }) => {
    const input = page
      .getByPlaceholder("Type a message. Ask me to 'show a card about cats'.")
      .first();
    await input.fill("show a small card body about hummingbirds");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
