import { test, expect } from "@playwright/test";

test.describe("Agentic Chat (Reasoning)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("Show reasoning suggestion pill fires the canonical prompt", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Show reasoning/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
