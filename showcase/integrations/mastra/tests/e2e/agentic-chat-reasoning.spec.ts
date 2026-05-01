import { test, expect } from "@playwright/test";

test.describe("Agentic Chat (Reasoning)", () => {
  test("chat input is visible", async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("canonical suggestion pill fires the reasoning prompt", async ({
    page,
  }) => {
    await page.goto("/demos/agentic-chat-reasoning");
    const pill = page.getByRole("button", { name: /Show reasoning/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();
    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
