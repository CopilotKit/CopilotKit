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
    await expect(
      page.locator('[data-testid="copilot-message-list"]'),
    ).toBeVisible({ timeout: 10000 });
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
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Plan a product launch for a new mobile app.");
    await input.press("Enter");

    // Wait for the run to settle (no in-progress markers anywhere on the page).
    await expect(
      page.locator('[data-testid="agent-step"][data-status="in_progress"]'),
    ).toHaveCount(0, { timeout: 120000 });

    const steps = page.locator('[data-testid="agent-step"]');
    const total = await steps.count();
    expect(total).toBeGreaterThan(0);

    // Every step must end in `completed` — guards against the "step 3 stuck"
    // regression where the agent terminated without flipping the last step.
    const completed = page.locator(
      '[data-testid="agent-step"][data-status="completed"]',
    );
    await expect(completed).toHaveCount(total);
  });

  // Regression: the aimock fixture used to emit a single set_steps tool call
  // with all three steps already `completed`, so the card mounted in its
  // final state with no sequential animation. The pill's whole point is the
  // pending → in_progress → completed progression spelled out in the
  // backend's SYSTEM_PROMPT, which requires a 7-call chain of set_steps
  // emissions threaded via toolCallId. This test pins that we observe at
  // least one step in `pending` state during the run — proof that the chain
  // is starting from the all-pending leg, not short-circuiting to all-done.
  test("steps animate through pending before completing (no fixture short-circuit)", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Plan a product launch/i }).click();

    await expect(page.locator('[data-testid="agent-state-card"]')).toBeVisible({
      timeout: 60000,
    });

    // At least one step must be observed in `pending` state. With the
    // short-circuit bug the steps went straight to `completed` and this
    // count would always be 0.
    await expect
      .poll(
        () =>
          page
            .locator('[data-testid="agent-step"][data-status="pending"]')
            .count(),
        { intervals: [250], timeout: 30000 },
      )
      .toBeGreaterThan(0);
  });
});
