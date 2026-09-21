import { runToolsAgentLocalContract } from "../../../../harness/src/probes/scripts/_pill-contracts-tools-agents";
import { test, expect } from "@playwright/test";

// QA reference: qa/reasoning-default.md
// Demo source: src/app/demos/reasoning-default/page.tsx
//
// This cell does NOT override the `reasoningMessage` slot. CopilotKit's
// built-in `CopilotChatReasoningMessage` renders the reasoning as a
// collapsible card. The page exposes a "Show reasoning" suggestion pill
// whose message matches the aimock fixture in showcase/aimock/d5-all.json,
// so streaming is deterministic in CI.

test.describe("[diagnostic] Reasoning: Default", () => {
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

    // The cell uses CopilotKit's default `CopilotChatReasoningMessage`,
    // which doesn't emit a testid — its visible signal is the
    // streaming/complete header label ("Thinking…" while streaming,
    // "Thought for …" once complete). Asserting on either label proves
    // the reasoning collapsible mounted.
    await expect(page.getByText(/Thinking…|Thought for/i).first()).toBeVisible({
      timeout: 60_000,
    });
  });
});

// Shared canonical contract; direct local evidence cannot certify a public matrix cell.
test("canonical actual-pill contract @functional-pill", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  await page.goto("/demos/reasoning-default");
  const result = await runToolsAgentLocalContract(
    page,
    "reasoning-default",
    "claude-sdk-typescript",
    page.url(),
  );
  await testInfo.attach("canonical-pill-execution", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.pillExecution?.completed, JSON.stringify(result)).toBe(true);
});
