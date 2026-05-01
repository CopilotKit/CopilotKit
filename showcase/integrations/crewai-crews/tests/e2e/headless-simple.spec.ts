import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page renders heading and input", async ({ page }) => {
    await expect(page.getByText("Headless Chat (Simple)")).toBeVisible();
    await expect(
      page.getByPlaceholder(
        "Type a message. Ask me to 'show a card about cats'.",
      ),
    ).toBeVisible();
  });

  test("empty-state message is visible initially", async ({ page }) => {
    await expect(page.getByText("No messages yet. Say hi!")).toBeVisible();
  });

  // Canonical e2e suggestion — see showcase/aimock/_canonical-catalog.json.
  // Headless demo doesn't render the suggestion pill UX; the catalog
  // message is exercised by typing it into the custom composer textarea.
  test("Card body catalog prompt renders an assistant message", async ({
    page,
  }) => {
    const textarea = page.getByPlaceholder(
      "Type a message. Ask me to 'show a card about cats'.",
    );
    await textarea.fill("show a small card body about hummingbirds");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
