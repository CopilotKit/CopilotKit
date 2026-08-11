import { test, expect } from "@playwright/test";

// Behavioral e2e for the generic hitl demo (OpenClaw), run against aimock.
//
// The demo registers a human-in-the-loop tool via `useHumanInTheLoop`:
// `generate_task_steps(steps)`. Its render() paints an in-chat review card
// (data-testid="select-steps") listing the proposed steps
// (data-testid="step-item") with Confirm/Reject controls. OpenClaw's first
// call (hasToolResult: false) emits the generate_task_steps toolCall → the
// card renders; the aimock terminator fixture closes the turn after the user
// responds. Prompts match showcase/aimock/d4/openclaw/chat.json.
test.describe("HITL — task-steps review flow", () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("page loads with chat input and both plan suggestions", async ({
    page,
  }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible({
      timeout: 20000,
    });
    for (const title of ["Simple plan", "Complex plan"]) {
      await expect(page.getByRole("button", { name: title })).toBeVisible({
        timeout: 15000,
      });
    }
  });

  test("'Simple plan' renders the steps review card", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Please plan a trip to Mars in 5 steps.");
    await input.press("Enter");

    const card = page.locator('[data-testid="select-steps"]');
    await expect(card).toBeVisible({ timeout: 60000 });

    const steps = page.locator('[data-testid="step-item"]');
    expect(await steps.count()).toBeGreaterThan(0);

    // The decision surface (Confirm/Reject) is present.
    await expect(page.locator('[data-testid="confirm-steps"]')).toBeVisible();
  });

  test("confirming the steps resolves the HITL and shows a decision badge", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Please plan a trip to Mars in 5 steps.");
    await input.press("Enter");

    const confirm = page.locator('[data-testid="confirm-steps"]');
    await expect(confirm).toBeVisible({ timeout: 60000 });
    await confirm.click();

    // The decision badge replaces the Confirm/Reject controls.
    await expect(page.locator('[data-testid="steps-decision"]')).toBeVisible({
      timeout: 10000,
    });

    // The terminator fixture returns the agent's acknowledgement text.
    await expect(
      page.locator('[data-testid="copilot-assistant-message"]').first(),
    ).toBeVisible({ timeout: 30000 });
  });
});
