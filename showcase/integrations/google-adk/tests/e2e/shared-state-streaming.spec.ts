import { test, expect } from "@playwright/test";

// State Streaming demo — Google ADK.
//
// Mirrors langgraph-python/tests/e2e/shared-state-streaming.spec.ts.
//
// Demo source: src/app/demos/shared-state-streaming/page.tsx
// Backend agent: src/agents/shared_state_streaming_agent.py
//
// Per-token state-delta streaming. The agent's `write_document` tool
// argument (`content`) is forwarded into `state.document` via
// PredictStateMapping (+ streaming_function_call_arguments=True). On the
// frontend, useAgent({ updates: [OnStateChanged, OnRunStatusChanged] })
// re-renders DocumentView each time `state.document` grows and toggles
// the "LIVE" badge while the agent is running. Through Gemini Studio
// the per-token granularity falls back to chunk-level deltas (still
// emits STATE_DELTA, just coarser).

const PILLS = {
  poem: "Write a short poem",
  email: "Draft an email",
  quantum: "Explain quantum computing",
} as const;

test.describe("State Streaming", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/shared-state-streaming");
  });

  test("page loads with document panel, sidebar, and 3 verbatim pills", async ({
    page,
  }) => {
    // Document panel mounts with its testid and the empty-state hint.
    await expect(page.getByTestId("document-view")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText(
        "Ask the agent to write something — its output will stream here token by token.",
      ),
    ).toBeVisible();

    // CopilotSidebar exposes the demo placeholder.
    await expect(
      page.getByPlaceholder("Ask me to write something..."),
    ).toBeVisible({ timeout: 15_000 });

    // 3 verbatim suggestion pills.
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    for (const title of Object.values(PILLS)) {
      await expect(suggestions.filter({ hasText: title }).first()).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test("initial state: 0 chars, no LIVE badge", async ({ page }) => {
    await expect(page.getByTestId("document-char-count")).toHaveText(
      "0 chars",
      { timeout: 15_000 },
    );
    await expect(page.getByTestId("document-live-badge")).toHaveCount(0);
  });

  test("clicking 'Write a short poem' streams document content into state", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: PILLS.poem })
      .first()
      .click();

    // After streaming finishes, the document-content node must be visible
    // and the char-count must be non-zero. We assert on the final state
    // rather than racing the streaming ticks — both modes (per-token via
    // Vertex AI, chunk-level via Gemini Studio) converge here.
    const content = page.getByTestId("document-content");
    await expect(content).toBeVisible({ timeout: 90_000 });

    const text = (await content.textContent())?.trim() ?? "";
    expect(text.length, "document should be non-empty").toBeGreaterThan(0);

    // Char counter reflects the streamed content.
    const charCountText =
      (await page.getByTestId("document-char-count").textContent()) ?? "";
    const m = charCountText.match(/(\d+)\s+chars/);
    expect(
      m,
      `char-count display "${charCountText}" should match "N chars"`,
    ).not.toBeNull();
    if (m) {
      expect(Number(m[1])).toBeGreaterThan(0);
    }
  });

  test("clicking 'Draft an email' streams document content into state", async ({
    page,
  }) => {
    await page
      .locator('[data-testid="copilot-suggestion"]')
      .filter({ hasText: PILLS.email })
      .first()
      .click();

    const content = page.getByTestId("document-content");
    await expect(content).toBeVisible({ timeout: 90_000 });
    const text = (await content.textContent())?.trim() ?? "";
    expect(text.length).toBeGreaterThan(0);
  });
});
