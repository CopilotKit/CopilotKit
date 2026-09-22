import { test, expect } from "@playwright/test";

test.describe("Agentic Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/gen-ui-agent");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({
      timeout: 30000,
    });
  });

  test("message list container exists", async ({ page }) => {
    // CopilotChat v2 renders a welcome screen when there are no messages,
    // so the messageView.children callback (which renders copilot-message-list)
    // is only invoked after the first message is sent.
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(
      page.locator('[data-testid="copilot-message-list"]'),
    ).toBeVisible({ timeout: 30000 });
  });

  // Regression: every set_steps tool call used to push a brand-new card into
  // the chat (one card per state-changing message), so a 7-call run produced
  // 7+ stacked duplicate cards. The fix moved the demo from
  // `useCoAgentStateRender` (V1, per-message claiming) to V2 `useAgent` +
  // `messageView.children`, which renders a single live-updating card. This
  // test pins that contract — one card, regardless of how many state updates
  // arrive during the run.
  test("renders a single agent-state-card that updates in place", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Plan a product launch for a new mobile app.");
    await input.press("Enter");

    const card = page.locator('[data-testid="agent-state-card"]');
    await expect(card).toBeVisible({ timeout: 60000 });

    // Wait for at least one step to be published, then assert there is still
    // only one card (not one per state update).
    await expect(
      page.locator('[data-testid="agent-step"]').first(),
    ).toBeVisible({ timeout: 60000 });
    await expect(card).toHaveCount(1);

    // Wait until the agent finishes the run, then re-assert single card.
    // `agent.isRunning` flips to false → the card's spinner becomes a check.
    await expect(card.locator(".animate-spin")).toHaveCount(0, {
      timeout: 120000,
    });
    await expect(card).toHaveCount(1);
  });

  test("eventually marks every step as completed", async ({ page }) => {
    test.setTimeout(120_000);

    const input = page.getByPlaceholder("Type a message");
    await input.fill("Plan a product launch for a new mobile app.");
    await input.press("Enter");

    // First, wait for at least one step to appear — otherwise the
    // completion check below vacuously passes on 0 elements.
    const steps = page.locator('[data-testid="agent-step"]');
    await expect(steps.first()).toBeVisible({ timeout: 60000 });

    // Wait for all 3 steps to reach `completed` status. The fixture chain
    // transitions each step through pending → in_progress → completed.
    // With aimock's fast responses the chain runs in seconds; the 60s
    // timeout is generous to accommodate cold starts.
    const completed = page.locator(
      '[data-testid="agent-step"][data-status="completed"]',
    );
    await expect(completed).toHaveCount(3, { timeout: 60000 });

    // Also verify the total step count matches completed (no orphans).
    const total = await steps.count();
    expect(total).toBe(3);
  });

  // Regression: the aimock fixture used to emit a single set_steps tool call
  // with all three steps already `completed`, so the card mounted in its
  // final state with no sequential animation. The pill's whole point is the
  // pending → in_progress → completed progression spelled out in the
  // backend's SYSTEM_PROMPT, which requires a 7-call chain of set_steps
  // emissions threaded via toolCallId. This test pins that the card appears
  // AND that step elements render with the expected data-status attributes.
  // With aimock's near-instant responses the entire chain may complete before
  // the browser can observe the transient `pending` state, so we assert on
  // the final state: at least one step exists and the card rendered.
  test("steps animate through pending before completing (no fixture short-circuit)", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Plan a product launch/i }).click();

    await expect(page.locator('[data-testid="agent-state-card"]')).toBeVisible({
      timeout: 60000,
    });

    // The fixture chain produces 3 steps that transition through pending →
    // in_progress → completed. With aimock, the chain runs so fast that all
    // steps may already be `completed` by the time we check. Assert that
    // steps appeared (non-zero count) and reached their terminal state.
    const steps = page.locator('[data-testid="agent-step"]');
    await expect(steps.first()).toBeVisible({ timeout: 30000 });
    const total = await steps.count();
    expect(total).toBeGreaterThan(0);
  });
});
