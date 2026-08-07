import { test, expect } from "@playwright/test";

// Behavioral e2e for the reasoning-default demo (OpenClaw), run against aimock
// (deterministic LLM). The gateway injects X-AIMock-Context: openclaw, so the
// prompt matches the fixture in showcase/aimock/d4/openclaw/chat.json.
//
// The page renders <CopilotChat> at /api/copilotkit-reasoning (agent id
// "reasoning-default") with NO slot override, so reasoning is drawn by
// CopilotKit's built-in `CopilotChatReasoningMessage` (a collapsible whose
// header reads "Thinking…" while streaming and "Thought for X" once complete —
// no dedicated testid). The demo exposes a single "Show reasoning" suggestion
// pill whose message is the reasoning-eliciting sky question; the matching
// aimock fixture returns a `reasoning` string (drives the reasoning panel) plus
// the final `content` (mentions "Rayleigh scattering"), so both the reasoning
// collapsible and the fixture-specific answer text are load-bearing assertions.
test.describe("Reasoning: Default", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/reasoning-default");
  });

  test("page renders with a chat input", async ({ page }) => {
    await expect(
      page.locator('[data-testid="copilot-chat-input"]'),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("Show reasoning suggestion pill renders", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /Show reasoning/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("Show reasoning pill drives a reasoning collapsible and the fixture answer", async ({
    page,
  }) => {
    const pill = page.getByRole("button", { name: /Show reasoning/i }).first();
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await pill.click();

    // The built-in CopilotChatReasoningMessage exposes no testid; its visible
    // signal is the header label ("Thinking…" while streaming, "Thought for …"
    // once complete). Either proves the reasoning collapsible mounted, which
    // only happens because the fixture returned a `reasoning` field.
    await expect(page.getByText(/Thinking…|Thought for/i).first()).toBeVisible({
      timeout: 60_000,
    });

    // The assistant message renders and carries the fixture-specific answer
    // text, proving the aimock fixture (not a live model) drove the run.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Rayleigh scattering/i).last()).toBeVisible({
      timeout: 60_000,
    });
  });
});
