import { test, expect } from "@playwright/test";

test.describe("Reasoning (Default Render)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default-render");
  });

  test("chat UI renders on load", async ({ page }) => {
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible();
  });

  test("default reasoning card renders after sending a prompt", async ({
    page,
  }) => {
    const input = page.getByPlaceholder(/type a message/i);
    await input.fill("Why is the sky blue? Think step by step.");
    await input.press("Enter");

    // The built-in CopilotChatReasoningMessage primitive renders a card
    // with "Thought" (post-completion) or "Thinking" (while streaming) text.
    await expect(page.getByText(/thought|thinking/i).first()).toBeVisible({
      timeout: 60000,
    });
  });
});
