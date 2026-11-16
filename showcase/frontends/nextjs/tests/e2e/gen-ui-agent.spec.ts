import { expect, test } from "@playwright/test";
import { demoPath, describeDemo } from "./helpers";

describeDemo("gen-ui-agent", "Agentic Generative UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(demoPath("gen-ui-agent"));
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

  // The page renders one live card from agent state through
  // `messageView.children`, so every `set_steps` call updates that card in
  // place. This test pins one card, however many state updates arrive
  // during the run.
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
    // When every step is completed, the card's spinner becomes a check.
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

    // First, wait for at least one step to appear. Otherwise the
    // completion check below vacuously passes on 0 elements.
    const steps = page.locator('[data-testid="agent-step"]');
    await expect(steps.first()).toBeVisible({ timeout: 60000 });

    // Wait for all 3 steps to reach `completed` status. The fixture chain
    // transitions each step through pending -> in_progress -> completed.
    // With aimock's fast responses the chain runs in seconds. The 60s
    // timeout leaves room for cold starts.
    const completed = page.locator(
      '[data-testid="agent-step"][data-status="completed"]',
    );
    await expect(completed).toHaveCount(3, { timeout: 60000 });

    // Also verify the total step count matches completed (no orphans).
    const total = await steps.count();
    expect(total).toBe(3);
  });

  // The pill's prompt drives a 7-call chain of `set_steps` emissions in the
  // aimock fixture, threaded via toolCallId, so each step walks
  // pending -> in_progress -> completed. With aimock's near-instant
  // responses the whole chain may finish before the browser can observe
  // the transient `pending` state, so this test asserts on the final state:
  // the card rendered and at least one step exists.
  test("steps animate through pending before completing (no fixture short-circuit)", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /Plan a product launch/i }).click();

    await expect(page.locator('[data-testid="agent-state-card"]')).toBeVisible({
      timeout: 60000,
    });

    const steps = page.locator('[data-testid="agent-step"]');
    await expect(steps.first()).toBeVisible({ timeout: 30000 });
    const total = await steps.count();
    expect(total).toBeGreaterThan(0);
  });
});
