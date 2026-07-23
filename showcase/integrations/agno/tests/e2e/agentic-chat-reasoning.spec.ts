import { test, expect } from "@playwright/test";

test.describe("Agentic Chat (Reasoning)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/agentic-chat-reasoning");
  });

  test("chat UI renders on load", async ({ page }) => {
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  test("reasoning block surfaces after sending a prompt", async ({ page }) => {
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill("Why is the sky blue? Think step by step.");
    await input.press("Enter");

    // Custom ReasoningBlock renders with this testid.
    await expect(
      page.locator('[data-testid="reasoning-block"]').first(),
    ).toBeVisible({ timeout: 60000 });
  });
});
