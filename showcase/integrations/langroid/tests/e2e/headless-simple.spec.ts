import { test, expect } from "@playwright/test";

test.describe("Headless Simple", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/headless-simple");
  });

  test("headless chat heading visible", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /Headless Chat \(Simple\)/i }),
    ).toBeVisible();
  });

  test("empty state shows placeholder text", async ({ page }) => {
    await expect(page.getByText("No messages yet")).toBeVisible();
  });

  test("sends a message via custom input", async ({ page }) => {
    const input = page.locator("textarea");
    await input.fill("hello");
    await input.press("Enter");
    // User bubble appears (the hand-rolled UI renders user content as plain text)
    await expect(page.getByText("hello").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
