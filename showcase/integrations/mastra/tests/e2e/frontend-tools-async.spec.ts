import { test, expect } from "@playwright/test";

test.describe("Frontend Tools (Async)", () => {
  test("chat input is visible", async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("canonical suggestion pill fires the prompt", async ({ page }) => {
    await page.goto("/demos/frontend-tools-async");
    const pill = page.getByRole("button", { name: /Async metric/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="notes-card"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
