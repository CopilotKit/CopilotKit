import { test, expect } from "@playwright/test";

test.describe("Auth demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/auth");
  });

  test("page shows unauthenticated state on load", async ({ page }) => {
    await expect(page.getByText(/Authenticate/i).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("clicking Authenticate unlocks the chat", async ({ page }) => {
    const authButton = page.getByRole("button", { name: /Authenticate/i });
    if (await authButton.isVisible()) {
      await authButton.click();
    }
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 15000,
    });
  });
});
