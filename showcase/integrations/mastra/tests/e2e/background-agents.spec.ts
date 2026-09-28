import { test, expect } from "@playwright/test";

// QA reference: qa/background-agents.md
// Demo source: src/app/demos/background-agents/page.tsx
// Backend agent: backgroundAgentsAgent (src/mastra/agents/index.ts) +
//   run_deep_research tool (src/mastra/tools/background-research.ts)
// Runtime: src/app/api/copilotkit-background-agents/route.ts
//
// Pattern: Mastra native BACKGROUND TASKS surfaced as an AG-UI ACTIVITY.
// The run_deep_research tool is flagged `background: { enabled: true }` and
// the Mastra instance enables the BackgroundTaskManager, so when the agent
// calls the tool Mastra dispatches it in the background and emits a
// `background-task-started` lifecycle chunk. MastraAgent maps that to an
// activity event (type `mastra-background-task`) and SUPPRESSES the normal
// tool pill; the page registers `backgroundTaskActivityRenderer` via
// `renderActivityMessages`, which paints a live "working" card
// (data-testid="background-task-activity").
//
// DETERMINISM SCOPE: completion is delivered OUT OF BAND — on the dispatching
// run's stream Mastra emits only `started` + a placeholder result, so within
// the turn the card's status stays `running` ("Working…"). This spec asserts
// the deterministic subset: page loads, pills render, and a "working"
// activity card appears. It intentionally does NOT assert completion.

test.describe("Background Agents (Mastra background task → activity card)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/background-agents");
  });

  test("page loads with chat input and no activity card rendered", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(
      page.locator('[data-testid="background-task-activity"]'),
    ).toHaveCount(0);
  });

  test("both suggestion pills render with verbatim titles", async ({
    page,
  }) => {
    const suggestions = page.locator('[data-testid="copilot-suggestion"]');
    await expect(
      suggestions.filter({ hasText: "Research AI agent frameworks" }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      suggestions
        .filter({ hasText: "Investigate renewable energy trends" })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("dispatching deep research shows a 'working' activity card", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: /Research AI agent frameworks/i })
      .click();

    // The backgrounded tool surfaces ONLY as an activity card — never a
    // normal tool pill.
    const card = page.locator('[data-testid="background-task-activity"]');
    await expect(card.first()).toBeVisible({ timeout: 60_000 });

    // In-run terminal state is `running` (completion is out of band), so the
    // card must read "Working…".
    await expect(
      page.locator('[data-testid="background-task-status"]').first(),
    ).toHaveText(/Working/i, { timeout: 60_000 });

    // The card carries the running status attribute.
    await expect(card.first()).toHaveAttribute(
      "data-status",
      /running|resumed/,
    );
  });

  test("typed research prompt also shows a working activity card", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Kick off deep research on emerging renewable energy trends for 2026.",
    );
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="background-task-activity"]').first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
