import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

// This demo does not override the `reasoningMessage` slot. CopilotKit's
// built-in `CopilotChatReasoningMessage` renders the reasoning as a
// collapsible block. The "Show reasoning" suggestion sends the prompt that
// the integration's aimock fixture answers with reasoning, so the stream is
// deterministic.

describeDemo("reasoning-default", "Reasoning: Default", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("reasoning-default"));
  });

  test("page renders without errors", async ({ page }) => {
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible();
  });

  test("Show reasoning pill renders a reasoning-role message", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Show reasoning/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    // The built-in reasoning block has no test id. Its header reads
    // "Thinking…" while it streams and "Thought for …" when it ends, so
    // either label proves that the block mounted.
    await expect(page.getByText(/Thinking…|Thought for/i).first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
