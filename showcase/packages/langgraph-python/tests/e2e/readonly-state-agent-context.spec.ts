import { test, expect } from "@playwright/test";

// QA reference: qa/readonly-state-agent-context.md
// Demo source: src/app/demos/readonly-state-agent-context/page.tsx
//
// The demo publishes three frontend-only values to the agent via
// `useAgentContext`: `userName` (default "Atai"),
// `userTimezone` (default "America/Los_Angeles"), and `recentActivity`
// (array of strings with two entries checked by default). The context
// card lives in the left sidebar (`data-testid="context-card"`) with
// per-field testids: `ctx-name`, `ctx-timezone`, `ctx-state-json`. The
// chat pane on the right uses the placeholder "Ask about your context..."
// No frontend tool — the agent simply reads the context and replies. We
// assert on (a) card + default values, (b) JSON preview reactivity to
// local state edits, and (c) the round-trip signal that the agent
// produced an assistant turn after a context-referencing prompt. We
// deliberately avoid asserting on LLM wording.

test.describe("Readonly Agent Context (useAgentContext)", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/readonly-state-agent-context");
  });

  test("context card renders with default values and chat composer", async ({
    page,
  }) => {
    await expect(page.getByTestId("context-card")).toBeVisible({
      timeout: 15_000,
    });

    // Name input defaults to "Atai" (verbatim in page.tsx).
    await expect(page.getByTestId("ctx-name")).toHaveValue("Atai");

    // Timezone <select> defaults to America/Los_Angeles.
    await expect(page.getByTestId("ctx-timezone")).toHaveValue(
      "America/Los_Angeles",
    );

    // Published Context JSON reflects both defaults plus the 2-entry
    // recentActivity array. We don't assert on exact whitespace — just on
    // presence of the three expected keys + the "Atai" default.
    const json = page.getByTestId("ctx-state-json");
    await expect(json).toBeVisible();
    await expect(json).toContainText('"name": "Atai"');
    await expect(json).toContainText('"timezone": "America/Los_Angeles"');
    await expect(json).toContainText('"recentActivity"');

    // Chat composer: placeholder is the demo-specific override.
    await expect(
      page.getByPlaceholder("Ask about your context..."),
    ).toBeVisible();
  });

  test("editing name + timezone updates the published JSON preview", async ({
    page,
  }) => {
    const json = page.getByTestId("ctx-state-json");

    // Edit name → "Jamie". Clearing first so the .fill() replaces cleanly.
    await page.getByTestId("ctx-name").fill("Jamie");
    await expect(json).toContainText('"name": "Jamie"');

    // Change timezone via <select>.
    await page.getByTestId("ctx-timezone").selectOption("Asia/Tokyo");
    await expect(json).toContainText('"timezone": "Asia/Tokyo"');
  });

  // SKIP: this suggestion round-trips a real LLM reply through Railway
  // via the `readonly_state_agent_context` graph. v2 CopilotChat renders
  // assistant turns with `data-message-role="assistant"`, but on Railway
  // the reply sometimes takes longer than 60s to surface the first
  // message DOM node (no deterministic side effect to race against).
  // Un-skip when the agent deployment is stable or a
  // `data-testid="assistant-message"` marker is added. See W8-READONLY-1.
  test.skip('"Who am I?" suggestion round-trips to an assistant reply', async ({
    page,
  }) => {
    const suggestion = page.locator('[data-testid="copilot-suggestion"]', {
      hasText: "Who am I?",
    });
    await expect(suggestion.first()).toBeVisible({ timeout: 15_000 });
    await suggestion.click();

    // v2 CopilotChat: AssistantMessage receives `data-message-role="assistant"`
    // from RenderMessage; fall back to the legacy `data-role="assistant"`
    // selector that other specs use.
    const assistant = page.locator(
      '[data-message-role="assistant"], [data-role="assistant"]',
    );
    await expect(assistant.first()).toBeVisible({ timeout: 60_000 });
  });

  // SKIP: same Railway round-trip flakiness as the suggestion path. See
  // W8-READONLY-1.
  test.skip("typed prompt referencing context produces an assistant reply", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Ask about your context...");
    await input.fill("What is my name?");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const assistant = page.locator(
      '[data-message-role="assistant"], [data-role="assistant"]',
    );
    await expect(assistant.first()).toBeVisible({ timeout: 60_000 });
  });
});
