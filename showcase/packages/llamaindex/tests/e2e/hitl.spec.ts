import { test, expect } from "@playwright/test";

test.describe("Human in the Loop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/demos/hitl");
  });

  test("page loads with chat input", async ({ page }) => {
    await expect(page.getByPlaceholder("Type a message")).toBeVisible();
  });

  test("sends message and gets assistant response", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Hello");
    await input.press("Enter");

    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test("task request shows step selector with checkboxes", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill(
      "Create a plan with steps to organize a team offsite event",
    );
    await input.press("Enter");

    // Either the LangGraph interrupt StepSelector or the HITL StepsFeedback should appear
    const stepSelector = page.locator('[data-testid="select-steps"]');
    await expect(stepSelector.first()).toBeVisible({ timeout: 60000 });

    // Should have at least one step item with a checkbox
    const stepItems = page.locator('[data-testid="step-item"]');
    await expect(stepItems.first()).toBeVisible({ timeout: 5000 });

    // Each step should have a checkbox input
    const checkbox = stepItems.first().locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();

    // Each step should have descriptive text
    const stepText = stepItems.first().locator('[data-testid="step-text"]');
    await expect(stepText).not.toBeEmpty();
  });

  test("step selector shows enabled count and has action button", async ({
    page,
  }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Plan the steps to write a quarterly report");
    await input.press("Enter");

    const stepSelector = page.locator('[data-testid="select-steps"]').first();
    await expect(stepSelector).toBeVisible({ timeout: 60000 });

    // Should show a count indicator (e.g., "3/3 selected")
    await expect(stepSelector.getByText(/\d+\/\d+\s*selected/)).toBeVisible();

    // Should have either a "Perform Steps" button (interrupt) or Confirm/Reject buttons (HITL)
    const actionButton = stepSelector.locator("button").first();
    await expect(actionButton).toBeVisible();
  });

  test("can approve a step selection and agent continues", async ({ page }) => {
    const input = page.getByPlaceholder("Type a message");
    await input.fill("Plan a trip to mars in 5 steps");
    await input.press("Enter");

    // Wait for step selector
    const selector = page.locator('[data-testid="select-steps"]');
    await expect(selector).toBeVisible({ timeout: 60000 });

    // Find and click the action button (Perform Steps / Confirm)
    const actionBtn = page.locator(
      'button:has-text("Perform"), button:has-text("Confirm")',
    );
    await expect(actionBtn.first()).toBeVisible({ timeout: 5000 });
    await actionBtn.first().click();

    // After approval, agent should continue — look for accepted/confirmed state
    const confirmed = page.locator("text=/Accepted|Confirmed|selected/i");
    await expect(confirmed.first()).toBeVisible({ timeout: 10000 });
  });
});
