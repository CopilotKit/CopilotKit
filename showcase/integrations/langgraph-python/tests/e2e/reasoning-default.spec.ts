import { test, expect } from "@playwright/test";

// QA reference: qa/reasoning-default.md
// Demo source: src/app/demos/reasoning-default/page.tsx
//
// This cell does NOT override the `reasoningMessage` slot. CopilotKit's
// built-in `CopilotChatReasoningMessage` renders the reasoning as a
// collapsible card. The page exposes a "Show reasoning" suggestion pill
// whose message matches the aimock fixture in showcase/aimock/d5-all.json,
// so streaming is deterministic in CI.

test.describe("Reasoning: Default", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default");
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

    // The cell uses CopilotKit's default CopilotChatReasoningMessage. We
    // accept either its testid or the role-attribute marker — whichever
    // the runtime emits first.
    const reasoningRole = page
      .locator(
        '[data-testid="copilot-reasoning-message"], [data-message-role="reasoning"]',
      )
      .first();
    await expect(reasoningRole).toBeVisible({ timeout: 60_000 });
  });
});
