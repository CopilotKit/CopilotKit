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
});
