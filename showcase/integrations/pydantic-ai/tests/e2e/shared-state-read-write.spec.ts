import { test, expect } from "@playwright/test";

test.describe("Shared State (Read-Write)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-read-write");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Chat with the agent...")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("canonical suggestion pill fires the feature", async ({ page }) => {
    const pill = page.getByRole("button", { name: /Weekend plan/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
