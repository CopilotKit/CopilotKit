import { test, expect } from "@playwright/test";

test.describe("Frontend Tools (Async)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("notes query renders NotesCard", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Find my notes about project planning");
    await input.press("Enter");

    await expect(page.locator('[data-testid="notes-card"]').first()).toBeVisible(
      { timeout: 45000 },
    );
  });
});
