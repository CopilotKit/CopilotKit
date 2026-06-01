import { test, expect } from "@playwright/test";

// QA reference: qa/hitl-in-chat.md (sibling), demo: src/app/demos/hitl/page.tsx
// Demo source: src/app/demos/hitl/{page.tsx, step-selector.tsx, steps-feedback.tsx}
//
// The HITL demo wires BOTH a `useInterrupt` render (StepSelector — "Select
// Steps" / "Perform Steps") and a `useHumanInTheLoop` tool (StepsFeedback —
// "Review Steps" / Reject / Confirm). Which one surfaces depends on what the
// `human_in_the_loop` backend emits. Against the d6 aimock fixture
// (langgraph-python "trip to mars"), the agent emits a `generate_task_steps`
// tool call, so the `useHumanInTheLoop` StepsFeedback card renders. Both
// renders share the same testids — `select-steps`, `step-item`, `step-text` —
// so this spec asserts on those rather than on a single flow's button labels.
//
// Ported from showcase/integrations/{llamaindex,mastra}/tests/e2e/hitl.spec.ts
// (identical across both), which were authored flow-agnostic precisely so the
// same spec passes whether the demo takes the interrupt or the HITL-tool path.
// The ms-agent-dotnet variant hard-asserts the Reject branch ("will not
// execute the Mars trip plan", no "Great choices!"); LGP's fixture has no
// reject-branch response (a tool result of either accept OR reject resolves to
// "Great choices!"), so the faithful LGP spec exercises the approve flow.
//
// Selectors follow LGP convention: typed prompts + `copilot-send-button` +
// `[data-testid="copilot-assistant-message"]`.

test.describe("Human in the Loop", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    // Wait for the CopilotKit runtime POST before interacting; messages sent
    // against the provisional agent stub are otherwise silently dropped.
    const runtimeReady = page.waitForResponse(
      (res) =>
        res.url().includes("/api/copilotkit") &&
        res.request().method() === "POST" &&
        res.status() === 200,
    );
    await page.goto("/demos/hitl");
    await runtimeReady;
  });

  test("page loads with chat input and no step selector", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
    await expect(page.locator('[data-testid="select-steps"]')).toHaveCount(0);
  });

  test("task request shows a step selector with checkboxes", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Please plan a trip to mars in 5 steps.");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    // A single step-selector card surfaces regardless of the underlying flow.
    const stepSelector = page.locator('[data-testid="select-steps"]').first();
    await expect(stepSelector).toBeVisible({ timeout: 60_000 });

    // At least one step item with a checkbox and non-empty descriptive text.
    const stepItems = page.locator('[data-testid="step-item"]');
    await expect(stepItems.first()).toBeVisible({ timeout: 10_000 });
    await expect(
      stepItems.first().locator('input[type="checkbox"]'),
    ).toBeVisible();
    await expect(
      stepItems.first().locator('[data-testid="step-text"]'),
    ).not.toBeEmpty();

    // The card shows an N/N selected count and an action button.
    await expect(stepSelector.getByText(/\d+\/\d+\s*selected/)).toBeVisible();
    await expect(stepSelector.locator("button").first()).toBeVisible();
  });

  test("approving the step selection lets the agent continue", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Please plan a trip to mars in 5 steps.");
    await page.locator('[data-testid="copilot-send-button"]').first().click();

    const selector = page.locator('[data-testid="select-steps"]').first();
    await expect(selector).toBeVisible({ timeout: 60_000 });

    // Click the action button (Perform Steps for the interrupt render,
    // Confirm for the HITL-tool render — the fixture drives the latter).
    const actionBtn = page.locator(
      'button:has-text("Perform"), button:has-text("Confirm")',
    );
    await expect(actionBtn.first()).toBeVisible({ timeout: 10_000 });
    await actionBtn.first().click();

    // After approval, the action button is replaced (StepSelector unmounts;
    // StepsFeedback swaps buttons for an Accepted/Rejected banner).
    await expect(actionBtn.first()).not.toBeVisible({ timeout: 15_000 });

    // The agent continues the run with the selected steps.
    await expect(
      page
        .locator('[data-testid="copilot-assistant-message"]')
        .filter({ hasText: /Great choices/i })
        .first(),
    ).toBeVisible({ timeout: 45_000 });
  });
});
