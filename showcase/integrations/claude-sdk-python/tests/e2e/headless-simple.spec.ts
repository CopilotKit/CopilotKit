import { test, expect } from "@playwright/test";

test.describe("Headless Chat (Simple)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("page loads with heading and empty message hint", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Headless Chat (Simple)" }),
    ).toBeVisible();
    await expect(page.getByText("No messages yet. Say hi!")).toBeVisible();
  });

  test("send button is disabled when input is empty", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("Card body canonical prompt yields an assistant response", async ({
    page,
  }) => {
    // Headless-simple uses a custom textarea (no pill UX) — type the
    // catalog message directly and verify an assistant message renders.
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill("show a small card body about hummingbirds");
    await textarea.press("Enter");

    await expect(
      page.locator('[data-message-role="assistant"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
